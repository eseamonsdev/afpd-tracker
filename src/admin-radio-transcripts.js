const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (data, status = 200) => Response.json(data, { status, headers });
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const validGroup = value => value === "6001" || value === "5922";

export async function radioTranscripts(request, url, database) {
  if (!database) return json({ error: "D1 binding unavailable" }, 503);
  try {
    if (request.method === "GET") {
      const day = url.searchParams.get("date");
      const group = url.searchParams.get("talkgroup");
      const offset = Number(url.searchParams.get("offset") || "0");
      if (!validDate(day) || !validGroup(group) || !Number.isSafeInteger(offset) || offset < 0) {
        return json({ error: "Invalid date, talkgroup, or offset" }, 400);
      }
      const { results } = await database.prepare(
        `SELECT id, transcript, transcript_validated AS validated FROM radio_clips
         WHERE archive_date = ? AND talkgroup_number = ? ORDER BY clip_number LIMIT 251 OFFSET ?`
      ).bind(day, Number(group), offset).all();
      return json({ clips: results.map(row => ({ id: row.id, transcript: row.transcript,
        validated: row.validated === 1 })).slice(0, 250), has_more: results.length > 250 });
    }
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
    if (request.headers.get("Origin") !== url.origin ||
        !request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "Same-origin JSON request required" }, 403);
    }
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > 500000) return json({ error: "Request too large" }, 413);
    const body = await request.text();
    if (body.length > 500000) return json({ error: "Request too large" }, 413);
    const { changes } = JSON.parse(body);
    if (!Array.isArray(changes) || changes.length < 1 || changes.length > 100 ||
        changes.some(c => !c || typeof c.id !== "string" || !/^[\w.-]{1,150}$/.test(c.id) ||
          typeof c.transcript !== "string" || c.transcript.length > 30000 ||
          typeof c.validated !== "boolean" ||
          !(c.expected_transcript === null || typeof c.expected_transcript === "string") ||
          typeof c.expected_validated !== "boolean") ||
        new Set(changes.map(c => c.id)).size !== changes.length) {
      return json({ error: "Invalid changes" }, 400);
    }
    // Check the whole batch before writing, so a stale editor does not overwrite newer work.
    const current = await database.prepare(
      `SELECT id, transcript, transcript_validated FROM radio_clips WHERE id IN (${changes.map(() => "?").join(",")})`
    ).bind(...changes.map(c => c.id)).all();
    const existing = new Map(current.results.map(row => [row.id, row]));
    const conflicts = changes.filter(c => {
      const row = existing.get(c.id);
      return !row || row.transcript !== c.expected_transcript ||
        (row.transcript_validated === 1) !== c.expected_validated;
    });
    if (conflicts.length) return json({ error: "These clips changed since you opened them. Reload before saving.",
      ids: conflicts.map(c => c.id) }, 409);
    const results = await database.batch(changes.map(c => database.prepare(
      `UPDATE radio_clips SET transcript = ?, transcript_validated = ? WHERE id = ?
       AND transcript IS ? AND transcript_validated = ?`
    ).bind(c.transcript, Number(c.validated), c.id, c.expected_transcript, Number(c.expected_validated))));
    if (results.some(result => result.meta?.changes !== 1)) {
      return json({ error: "A clip changed during saving. Reload before making further edits." }, 409);
    }
    return json({ saved: changes.length });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Invalid JSON" }, 400);
    console.error("Radio transcript database error", error);
    return json({ error: "Database unavailable" }, 503);
  }
}
