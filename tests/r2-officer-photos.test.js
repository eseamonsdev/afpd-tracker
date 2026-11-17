import test from 'node:test';
import assert from 'node:assert/strict';
import {r2OfficerPhoto} from '../src/r2-officer-photos.js';

const url = 'https://staging.example.com/officer-photos/thumbnails/jonathan-wagley-thumbnail.webp';
const bucket = {
  async get(key) {
    assert.ok(['officer-photos/thumbnails/jonathan-wagley-thumbnail.webp', 'officer-photos/jonathan-wagley-photo.jpg'].includes(key));
    return {body: 'webp', size: 4, httpEtag: '"portrait"'};
  }
};

test('serves only generated thumbnails from R2 on the site origin', async () => {
  const image = await r2OfficerPhoto(new Request(url), bucket);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('Content-Type'), 'image/webp');
  assert.equal(image.headers.get('Cache-Control'), 'public, max-age=86400');
  assert.equal(await image.text(), 'webp');
  const head = await r2OfficerPhoto(new Request(url, {method: 'HEAD'}), bucket);
  assert.equal(head.body, null);
  assert.equal(head.headers.get('Content-Length'), '4');
  const portrait = await r2OfficerPhoto(new Request('https://staging.example.com/officer-photos/jonathan-wagley-photo.jpg'), bucket);
  assert.equal(portrait.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(await r2OfficerPhoto(new Request(url, {method: 'POST'}), bucket).then(r => r.status), 405);
  assert.equal(await r2OfficerPhoto(new Request('https://staging.example.com/officer-photos/private.jpg'), bucket), null);
  assert.equal(await r2OfficerPhoto(new Request('https://staging.example.com/officer-photos/thumbnails/../private.webp'), bucket), null);
});
