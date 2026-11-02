import fs from 'node:fs';
import path from 'node:path';

export function validateOriginalTranscripts(root = process.cwd()) {
  const directory = path.join(root, 'public/records/openmhz');
  let calls = 0;
  for (const folder of fs.readdirSync(directory, {withFileTypes: true})) {
    if (!folder.isDirectory()) continue;
    const file = path.join(directory, folder.name, 'calls.json');
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const call of [...data.calls, ...(data.duplicate_source_calls ?? [])]) {
      const original = call.original_transcript;
      if (!Object.hasOwn(call, 'original_transcript') ||
          (original !== null && typeof original !== 'string') ||
          (typeof call.transcript === 'string' && call.transcript.trim() && original === null)) {
        throw new Error(`Invalid original_transcript: ${folder.name}/${call.original_filename}`);
      }
      calls++;
    }
  }
  return calls;
}
