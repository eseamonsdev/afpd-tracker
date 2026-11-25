import fs from 'node:fs';

// Read the same descriptions shown by `make help` so the reference stays current.
const databaseTargets=new Set(['db-upload','db-reset','calls-from-db','evidence-from-db','evidence-to-db','promote-db']);
export default function () {
  const makefile=fs.readFileSync(new URL('../../Makefile',import.meta.url),'utf8');
  return [...makefile.matchAll(/^([a-zA-Z0-9_-]+):.*##\s*(.+)$/gm)]
    .map(([,name,description])=>({name,description}))
    .filter(command=>databaseTargets.has(command.name));
}
