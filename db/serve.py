"""Read-only local viewer for the officer and radio SQLite preview."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sqlite3
from urllib.parse import parse_qs, urlsplit

HERE = Path(__file__).resolve().parent
DEFAULT_DB = HERE / 'local/afpd.sqlite'
TABLES = ('officers', 'officer_names', 'radio_talkgroups', 'radio_ids',
          'radio_clips', 'radio_clip_sources')
RADIO_EVENTS = ('radio_clips', 'radio_clip_sources')


def query_database(database, table, search='', offset=0, limit=25, officer_id=None,
                   month=None, talkgroup=None):
    if table not in TABLES:
        raise ValueError('Unknown table')
    if not 0 <= offset <= 1_000_000 or not 1 <= limit <= 1000:
        raise ValueError('Invalid page')
    if officer_id is not None and (table != 'officer_names' or officer_id < 1):
        raise ValueError('Invalid officer filter')
    if month is not None and (table not in RADIO_EVENTS or
                              len(month) != 7 or month[4] != '-' or
                              not month[:4].isdigit() or not month[5:].isdigit()):
        raise ValueError('Invalid month filter')
    if talkgroup is not None and (table not in RADIO_EVENTS or not talkgroup.isdigit()):
        raise ValueError('Invalid talkgroup filter')
    search = search.strip()[:120]
    # The database and table names come from local code, never request input.
    connection = sqlite3.connect(f'file:{database}?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute('PRAGMA query_only = ON')
        where, values = [], []
        if search:
            text = f'%{search}%'
            if table == 'officers':
                where.append('''(o.url_slug LIKE ? OR o.legacy_entity_id LIKE ?
                    OR EXISTS (SELECT 1 FROM officer_names alias
                               WHERE alias.officer_id = o.id AND alias.name_text LIKE ?)
                    OR CAST(o.id AS TEXT) = ?)''')
                values.extend((text, text, text, search))
            elif table == 'officer_names':
                where.append('(n.name_text LIKE ? OR o.url_slug LIKE ? OR CAST(n.id AS TEXT) = ?)')
                values.extend((text, text, search))
            elif table == 'radio_talkgroups':
                where.append('(t.name LIKE ? OR CAST(t.number AS TEXT) LIKE ? OR t.system LIKE ?)')
                values.extend((text, text, text))
            elif table == 'radio_ids':
                where.append('r.id LIKE ?')
                values.append(text)
            elif table == 'radio_clips':
                where.append('''(c.id LIKE ? OR c.archive_date LIKE ? OR c.transcript LIKE ? OR
                    c.original_transcript LIKE ? OR CAST(c.clip_number AS TEXT) = ? OR
                    EXISTS (SELECT 1 FROM radio_clip_sources s
                            WHERE s.clip_id = c.id AND s.radio_id LIKE ?))''')
                values.extend((text, text, text, text, search, text))
            else:
                where.append('''(s.radio_id LIKE ? OR s.clip_id LIKE ? OR c.archive_date LIKE ? OR
                    CAST(c.clip_number AS TEXT) = ?)''')
                values.extend((text, text, text, search))
        if officer_id is not None:
            where.append('n.officer_id = ?')
            values.append(officer_id)
        if month is not None:
            where.append("c.archive_date LIKE ?")
            values.append(month + '-%')
        if talkgroup is not None:
            where.append('c.talkgroup_number = ?')
            values.append(int(talkgroup))
        if table == 'officers':
            from_sql = 'FROM officers o LEFT JOIN officer_names n ON n.id = o.display_name_id'
            select = 'o.*, n.name_text AS selected_display_name'
            order = 'o.id'
        elif table == 'officer_names':
            from_sql = 'FROM officer_names n JOIN officers o ON o.id = n.officer_id'
            select = 'n.*, (n.id = o.display_name_id) AS is_primary'
            order = 'n.id'
        elif table == 'radio_talkgroups':
            from_sql, select, order = 'FROM radio_talkgroups t', 't.*', 't.system, t.number'
        elif table == 'radio_ids':
            from_sql, select, order = 'FROM radio_ids r', 'r.*', 'r.id'
        elif table == 'radio_clips':
            from_sql, select, order = ('FROM radio_clips c', 'c.*',
                                       'c.archive_date, c.talkgroup_number, c.clip_number')
        else:
            from_sql = 'FROM radio_clip_sources s JOIN radio_clips c ON c.id = s.clip_id'
            select = 's.*, c.archive_date, c.talkgroup_number, c.clip_number'
            order = 'c.archive_date, c.talkgroup_number, c.clip_number, s.radio_id'
        condition = (' WHERE ' + ' AND '.join(where)) if where else ''
        total = connection.execute(f'SELECT COUNT(*) {from_sql}{condition}', values).fetchone()[0]
        rows = connection.execute(
            f'SELECT {select} {from_sql}{condition} ORDER BY {order} LIMIT ? OFFSET ?',
            (*values, limit, offset),
        ).fetchall()
        return {'table': table, 'total': total, 'offset': offset, 'limit': limit,
                'columns': list(rows[0].keys()) if rows else
                [row['name'] for row in connection.execute(f'PRAGMA table_info({table})')] +
                (['selected_display_name'] if table == 'officers' else
                 ['is_primary'] if table == 'officer_names' else
                 ['archive_date', 'talkgroup_number', 'clip_number'] if table == 'radio_clip_sources' else []),
                'rows': [dict(row) for row in rows]}
    finally:
        connection.close()


def handler_for(database):
    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, body, content_type):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'")
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            url = urlsplit(self.path)
            if url.path in ('/', '/db'):
                self.send_response(302)
                self.send_header('Location', '/db/')
                self.end_headers()
                return
            if url.path in ('/db/', '/db/index.html'):
                self.respond(200, (HERE / 'index.html').read_bytes(), 'text/html; charset=utf-8')
                return
            if url.path == '/db/api/tables':
                self.respond(200, json.dumps({'tables': TABLES}).encode(), 'application/json; charset=utf-8')
                return
            if url.path == '/db/api/radio-periods':
                with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as connection:
                    rows = connection.execute('''SELECT DISTINCT substr(archive_date,1,7) AS month,
                        talkgroup_number AS talkgroup FROM radio_clips
                        ORDER BY month DESC, talkgroup''').fetchall()
                self.respond(200, json.dumps({'periods': rows}).encode(), 'application/json; charset=utf-8')
                return
            if url.path.startswith('/db/api/table/'):
                try:
                    params = parse_qs(url.query)
                    result = query_database(database, url.path.removeprefix('/db/api/table/'),
                        params.get('q', [''])[0], int(params.get('offset', ['0'])[0]),
                        int(params.get('limit', ['25'])[0]),
                        int(params['officer_id'][0]) if 'officer_id' in params else None,
                        params.get('month', [None])[0], params.get('talkgroup', [None])[0])
                except (ValueError, sqlite3.Error) as error:
                    self.respond(400, json.dumps({'error': str(error)}).encode(), 'application/json; charset=utf-8')
                    return
                self.respond(200, json.dumps(result).encode(), 'application/json; charset=utf-8')
                return
            self.respond(404, b'Not found', 'text/plain; charset=utf-8')

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=DEFAULT_DB)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    database = args.database.resolve()
    if not database.is_file():
        parser.error(f'{database} does not exist; run python3 db/create_afpd_db.py first')
    with ThreadingHTTPServer(('127.0.0.1', args.port), handler_for(database)) as server:
        print(f'Officer database viewer: http://127.0.0.1:{server.server_port}/db/', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
