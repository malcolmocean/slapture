// scripts/check-stale.ts
import fs from 'fs';
import path from 'path';

function getNewestMtime(dir: string, ext: string): number {
  let newest = 0;

  function walk(d: string) {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        const mtime = fs.statSync(full).mtimeMs;
        if (mtime > newest) newest = mtime;
      }
    }
  }

  walk(dir);
  return newest;
}

const srcNewest = getNewestMtime('src', '.ts');
const distNewest = getNewestMtime('dist', '.js');

if (!distNewest) {
  console.error('\x1b[31m[STALE] dist/ not found. Run: pnpm build\x1b[0m');
  process.exit(1);
}

if (srcNewest > distNewest) {
  const diff = Math.round((srcNewest - distNewest) / 1000);
  console.error(`\x1b[31m[STALE] src/ is ${diff}s newer than dist/. Run: pnpm build\x1b[0m`);
  process.exit(1);
}

console.log('\x1b[32m[OK] dist/ is up to date\x1b[0m');
