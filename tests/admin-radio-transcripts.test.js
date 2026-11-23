import assert from "node:assert/strict";
import test from "node:test";
import { radioTranscripts } from "../src/admin-radio-transcripts.js";

function database() {
  const clips = new Map([["clip1", { id: "clip1", transcript: "original", transcript_validated: 0 }]]);
  return {
    clips,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async all() {
              return { results: sql.includes("archive_date =") ? [...clips.values()].slice(values[2], values[2] + 251) :
                values.map(id => clips.get(id)).filter(Boolean) };
            },
            async run() {
              const [transcript, validated, id, expected, expectedValidated] = values;
              const row = clips.get(id);
              if (!row || row.transcript !== expected || row.transcript_validated !== expectedValidated) {
                return { meta: { changes: 0 } };
              }
              row.transcript = transcript;
              row.transcript_validated = validated;
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
  };
}

test("admin transcript API reads and saves with an optimistic baseline", async () => {
  const url = new URL("https://example.org/admin/api/radio-transcripts?date=2026-11-22&talkgroup=5922");
  const db = database();
  const get = await radioTranscripts(new Request(url), url, db);
  assert.deepEqual((await get.json()).clips, [{ id: "clip1", transcript: "original", validated: false }]);
  assert.equal(get.headers.get("Cache-Control"), "no-store");
  const change = { id: "clip1", transcript: "corrected", validated: true,
    expected_transcript: "original", expected_validated: false };
  const request = (origin, edits = [change]) => new Request(url, { method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ changes: edits }) });
  assert.equal((await radioTranscripts(request("https://evil.example"), url, db)).status, 403);
  assert.equal((await radioTranscripts(request(url.origin, [{ ...change, validated: "yes" }]), url, db)).status, 400);
  assert.equal((await radioTranscripts(request(url.origin), url, db)).status, 200);
  assert.equal(db.clips.get("clip1").transcript, "corrected");
  assert.equal(db.clips.get("clip1").transcript_validated, 1);
  assert.equal((await radioTranscripts(request(url.origin), url, db)).status, 409);
});
