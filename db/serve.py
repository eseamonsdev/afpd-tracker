"""Read-only local viewer for the officer-name SQLite preview."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sqlite3
from urllib.parse import parse_qs, urlsplit

HERE = Path(__file__).resolve().parent
DEFAULT_DB = HERE / 'local/officer-names.sqlite'
TABLES = ('officers', 'officer_names')


def query_database(database, table, search='', offset=0, limit=25, officer_id=None):
    if table not in TABLES:
        raise ValueError('Unknown table')
    if not 0 <= offset <= 1_000_000 or not 1 <= limit <= 100:
        raise ValueError('Invalid page')
    if officer_id is not None and (table != 'officer_names' or officer_id < 1):
        raise ValueError('Invalid officer filter')
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
            else:
                where.append('(n.name_text LIKE ? OR o.url_slug LIKE ? OR CAST(n.id AS TEXT) = ?)')
                values.extend((text, text, search))
        if officer_id is not None:
            where.append('n.officer_id = ?')
            values.append(officer_id)
        if table == 'officers':
            from_sql = 'FROM officers o LEFT JOIN officer_names n ON n.id = o.display_name_id'
            select = 'o.*, n.name_text AS selected_display_name'
            order = 'o.id'
        else:
            from_sql = 'FROM officer_names n JOIN officers o ON o.id = n.officer_id'
            select = 'n.*, (n.id = o.display_name_id) AS is_primary'
            order = 'n.id'
        condition = (' WHERE ' + ' AND '.join(where)) if where else ''
        total = connection.execute(f'SELECT COUNT(*) {from_sql}{condition}', values).fetchone()[0]
        rows = connection.execute(
            f'SELECT {select} {from_sql}{condition} ORDER BY {order} LIMIT ? OFFSET ?',
            (*values, limit, offset),
        ).fetchall()
        return {'table': table, 'total': total, 'offset': offset, 'limit': limit,
                'columns': list(rows[0].keys()) if rows else
                [row['name'] for row in connection.execute(f'PRAGMA table_info({table})')] +
                (['selected_display_name'] if table == 'officers' else ['is_primary']),
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
            if url.path.startswith('/db/api/table/'):
                try:
                    params = parse_qs(url.query)
                    result = query_database(database, url.path.removeprefix('/db/api/table/'),
                        params.get('q', [''])[0], int(params.get('offset', ['0'])[0]),
                        int(params.get('limit', ['25'])[0]),
                        int(params['officer_id'][0]) if 'officer_id' in params else None)
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
        parser.error(f'{database} does not exist; run python3 db/import_officer_names.py first')
    with ThreadingHTTPServer(('127.0.0.1', args.port), handler_for(database)) as server:
        print(f'Officer database viewer: http://127.0.0.1:{server.server_port}/db/', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
