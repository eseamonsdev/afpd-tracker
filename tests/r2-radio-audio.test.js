import test from 'node:test';
import assert from 'node:assert/strict';
import {r2RadioAudio} from '../src/r2-radio-audio.js';
const url = 'https://example.com/records/openmhz/openmhz-afpd-car-to-car-2026-10-25/dcfems-6001-1792908038.m4a';
const bucket = {
  async head() { return {size:10, httpEtag:'"audio"', writeHttpMetadata() {}}; },
  async get(key, options) { return {body: options?.range ? '0123456789'.slice(options.range.offset, options.range.offset + options.range.length) : '0123456789'}; }
};
test('full audio, HEAD, seeking, suffix ranges, invalid ranges, cache validation', async () => {
  const full = await r2RadioAudio(new Request(url), bucket);
  assert.equal(full.status, 200); assert.equal(await full.text(), '0123456789');
  const head = await r2RadioAudio(new Request(url, {method:'HEAD'}), bucket);
  assert.equal(head.body, null); assert.equal(head.headers.get('Content-Length'), '10');
  const partial = await r2RadioAudio(new Request(url, {headers:{Range:'bytes=2-5'}}), bucket);
  assert.equal(partial.status, 206); assert.equal(partial.headers.get('Content-Range'), 'bytes 2-5/10'); assert.equal(await partial.text(), '2345');
  const suffix = await r2RadioAudio(new Request(url, {headers:{Range:'bytes=-3'}}), bucket);
  assert.equal(await suffix.text(), '789');
  const invalid = await r2RadioAudio(new Request(url, {headers:{Range:'bytes=20-'}}), bucket);
  assert.equal(invalid.status, 416);
  const cached = await r2RadioAudio(new Request(url, {headers:{'If-None-Match':'"audio"'}}), bucket);
  assert.equal(cached.status, 304);
  const changed = await r2RadioAudio(new Request(url, {headers:{Range:'bytes=2-5','If-Range':'"old"'}}), bucket);
  assert.equal(changed.status, 200);
});
test('does not expose other keys or upload endpoints', async () => {
  assert.equal(await r2RadioAudio(new Request('https://example.com/_connection-tests/test.txt'), bucket), null);
  assert.equal((await r2RadioAudio(new Request(url, {method:'PUT',body:'x'}), bucket)).status, 405);
});

test('archive index accepts verified R2 audio and rejects missing unverified audio', async (t) => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const {buildRadioIndex} = await import('../lib/build-radio-index.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-index-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const folder = 'openmhz-afpd-car-to-car-2026-10-25';
  fs.mkdirSync(path.join(dir, folder));
  const call = {original_filename:'dcfems-6001-1792908038.m4a', epoch:1792908038, displayed_seconds:3, sha256:'a'.repeat(64), size_bytes:100};
  call.audio_storage = {provider:'r2', verified:true, bucket:'afpd-public-media', key:`records/openmhz/${folder}/${call.original_filename}`, sha256:call.sha256, size_bytes:100};
  const manifest = path.join(dir, folder, 'calls.json');
  fs.writeFileSync(manifest, JSON.stringify({date:'2026-10-25', calls:[call]}));
  assert.equal(buildRadioIndex(dir).days[0].count, 1);
  call.audio_storage.verified = false;
  fs.writeFileSync(manifest, JSON.stringify({date:'2026-10-25', calls:[call]}));
  assert.throws(() => buildRadioIndex(dir), /Missing audio/);
});
