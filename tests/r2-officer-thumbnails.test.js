import test from 'node:test';
import assert from 'node:assert/strict';
import {r2OfficerThumbnail} from '../src/r2-officer-thumbnails.js';

const url = 'https://staging.example.com/officer-photos/thumbnails/jonathan-wagley-thumbnail.webp';
const bucket = {
  async get(key) {
    assert.equal(key, 'officer-photos/thumbnails/jonathan-wagley-thumbnail.webp');
    return {body: 'webp', size: 4, httpEtag: '"portrait"'};
  }
};

test('serves only generated thumbnails from R2 on the site origin', async () => {
  const image = await r2OfficerThumbnail(new Request(url), bucket);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('Content-Type'), 'image/webp');
  assert.equal(image.headers.get('Cache-Control'), 'public, max-age=86400');
  assert.equal(await image.text(), 'webp');
  const head = await r2OfficerThumbnail(new Request(url, {method: 'HEAD'}), bucket);
  assert.equal(head.body, null);
  assert.equal(head.headers.get('Content-Length'), '4');
  assert.equal(await r2OfficerThumbnail(new Request(url, {method: 'POST'}), bucket).then(r => r.status), 405);
  assert.equal(await r2OfficerThumbnail(new Request('https://staging.example.com/officer-photos/private.jpg'), bucket), null);
  assert.equal(await r2OfficerThumbnail(new Request('https://staging.example.com/officer-photos/thumbnails/../private.webp'), bucket), null);
});
