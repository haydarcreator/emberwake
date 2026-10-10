// Writes downloads/files.json (file name → size in bytes) so the website knows
// which installers exist.
//   node tools/list-downloads.mjs            → files in downloads/
//   node tools/list-downloads.mjs v1.1.0     → assets of that GitHub release (needs gh)
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';

const tag = process.argv[2];
const files = {};
if (tag) {
  const json = execFileSync('gh', ['release', 'view', tag, '--json', 'assets'], { encoding: 'utf8' });
  for (const a of JSON.parse(json).assets) files[a.name] = a.size;
} else {
  for (const name of readdirSync('downloads')) {
    if (name !== 'files.json') files[name] = statSync(`downloads/${name}`).size;
  }
}
writeFileSync('downloads/files.json', JSON.stringify(files, null, 2) + '\n');
console.log(`downloads/files.json: ${Object.keys(files).length} files`);
