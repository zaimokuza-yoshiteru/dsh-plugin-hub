import { readFile } from 'node:fs/promises';
import { validateCatalog } from '@zaimokuza/dsh-plugin-hub/catalog';
const catalog = validateCatalog(JSON.parse(await readFile(process.argv[2] ?? new URL('../plugins.json',import.meta.url),'utf8')));
if(!catalog.plugins.length) throw new Error('plugins.json must contain a catalog snapshot');
console.log(`Validated ${catalog.plugins.length} catalog entries (build does not access GitHub)`);
