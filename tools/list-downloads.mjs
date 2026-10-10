// Writes downloads/files.json (file name → size in bytes) so the website knows
// which installers are available. Run after copying installers into downloads/.
// Usage: node tools/list-downloads.mjs
import { readdirSync, statSync, writeFileSync } from 'node:fs';

const files = {};
for (const name of readdirSync('downloads')) {
  if (name === 'files.json') continue;
  files[name] = statSync(`downloads/${name}`).size;
}
writeFileSync('downloads/files.json', JSON.stringify(files, null, 2) + '\n');
console.log(`downloads/files.json: ${Object.keys(files).length} files`);
