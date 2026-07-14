const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
  });
}

const files = walk(srcDir);
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    console.error(`\nSyntax error in ${path.relative(root, file)}:`);
    console.error(result.stderr || result.stdout);
  }
}

if (failed) process.exit(1);
console.log(`Syntax check passed for ${files.length} JavaScript files.`);
