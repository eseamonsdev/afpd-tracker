import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateOriginalTranscripts} from '../lib/radio-transcript-schema.js';

test('all talkgroups require a saved original or an untranscribed null', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-schema-'));
  try {
    for (const group of [6001, 6036, 5922]) {
      const directory = path.join(root, 'public/records/openmhz', String(group));
      fs.mkdirSync(directory, {recursive: true});
      fs.writeFileSync(path.join(directory, 'calls.json'), JSON.stringify({calls: [
        {transcript: 'Current', original_transcript: 'First'},
        {original_transcript: null}
      ]}));
    }
    assert.equal(validateOriginalTranscripts(root), 6);
    const file = path.join(root, 'public/records/openmhz/6036/calls.json');
    for (const call of [{transcript: 'Missing original'}, {transcript: 'Published', original_transcript: null}]) {
      fs.writeFileSync(file, JSON.stringify({calls: [call]}));
      assert.throws(() => validateOriginalTranscripts(root), /Invalid original_transcript/);
    }
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
