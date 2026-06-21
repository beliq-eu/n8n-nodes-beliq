import { readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.svg') || entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

let count = 0;
for (const root of ['nodes', 'credentials']) {
  let icons = [];
  try {
    icons = walk(root);
  } catch {
    continue;
  }
  for (const icon of icons) {
    const dest = join('dist', icon);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(icon, dest);
    console.log(`icon: ${icon} -> ${dest}`);
    count++;
  }
}
if (count === 0) console.warn('no SVG icons found to copy');
