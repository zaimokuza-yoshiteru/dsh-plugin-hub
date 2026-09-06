import { mkdir, copyFile, chmod } from 'node:fs/promises';
await mkdir('lib', { recursive: true });
await copyFile('src/bin.js', 'lib/bin.js');
await chmod('lib/bin.js', 0o755);
console.log('Built CLI entry. Templates are shipped in the npm package.');
