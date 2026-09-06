import { readFile } from 'node:fs/promises';
import { validateCatalog } from '../src/catalog.js';
const file = process.argv[2] ?? 'catalog.example.json';
const catalog = validateCatalog(JSON.parse(await readFile(file, 'utf8')));
console.log(`Valid catalog: ${catalog.plugins.length} plugin(s) in ${file}`);
