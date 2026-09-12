import { readFile, writeFile, realpath, rename, rm } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseDocument, isSeq, isMap } from 'yaml';
import { jsTag } from './mcp-config.js';
export async function ownedFile(profile, file) {
  try { const path = await realpath(file); const rel = relative(profile, path); return !isAbsolute(rel) && !rel.startsWith('..') && !rel.split(/[\\/]/).includes('node_modules') ? path : null; } catch { return null; }
}
export async function atomicWrite(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
  try { await rename(temporary, file); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}
// Delete only a concrete, uniquely identified definition owned by this profile.
// Preserve all other YAML nodes, comments and native expression tags.
export async function findMcpDefinition(profile, entry) {
  if (!entry) return null;
  const candidates = [...new Set([entry.parent.tree.filename, join(profile, 'cordis.patch.yml'), join(profile, 'cordis.yml')].filter(Boolean))];
  for (const file of candidates) {
    const path = await ownedFile(profile, file); if (!path) continue;
    const original = await readFile(path, 'utf8'); const doc = parseDocument(original, { customTags: [jsTag] });
    if (doc.errors.length || doc.warnings.length) continue;
    const matches = [];
    function walk(node) {
      if (isSeq(node)) node.items.forEach((item, index) => {
        if (isMap(item) && item.get('id') === entry.options.id && item.get('name') === '@deepseek-ai/dsh-mcp-client') matches.push({ node, index });
        else walk(item);
      });
      else if (isMap(node)) node.items.forEach(pair => walk(pair.value));
    }
    walk(doc.contents);
    if (matches.length === 1) return { path, original, doc, ...matches[0] };
  }
  return null;
}
export async function deleteMcpDefinition(profile, entry) {
  const found = await findMcpDefinition(profile, entry);
  if (!found) throw new Error('此 MCP 来自共享配置或宿主包，请在来源处删除；Hub 可禁用它');
  if (await readFile(found.path, 'utf8') !== found.original) throw new Error('来源配置已变化，请刷新重试');
  found.node.items.splice(found.index, 1);
  await atomicWrite(found.path, String(found.doc));
  await entry.parent.remove(entry.options.id);
}
