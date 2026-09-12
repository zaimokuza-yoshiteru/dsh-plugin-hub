import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resourceWords, translate } from '../src/client/locale.js';
import { mcpFields } from '../src/client/mcp-help.js';

test('owned UI copy, configuration help and request errors all have English translations', async () => {
  const files = ['client/resources.jsx', 'client/mcp-help.js', 'resources.js', 'experiments.js', 'mcp-config.js', 'profile-files.js', 'dsh.js', 'index.js'];
  for (const file of files) {
    const source = await readFile(new URL('../src/' + file, import.meta.url), 'utf8');
    for (const [, text] of source.matchAll(/'([^'\n]*)'/g)) {
      if (/[\u4e00-\u9fff]/u.test(text)) assert(resourceWords[text], `${file}: missing translation for ${text}`);
    }
  }
  for (const [key, description, fallback] of mcpFields) {
    assert(resourceWords[description], key);
    if (/[\u4e00-\u9fff]/u.test(fallback)) assert(resourceWords[fallback], key);
  }
  for (const [key, value] of Object.entries(resourceWords)) {
    assert(value.trim(), key);
    assert.doesNotMatch(value, /[\u4e00-\u9fff]/u, key);
  }
});

test('language changes translate owned errors without altering environment names or external details', () => {
  const en = translate(text => resourceWords[text] ?? text);
  const zh = translate(text => text);
  assert.equal(en('启动 DSH 的环境中未设置 MCP_TOKEN'), 'MCP_TOKEN is not set in the environment used to start DSH.');
  assert.equal(zh('启动 DSH 的环境中未设置 MCP_TOKEN'), '启动 DSH 的环境中未设置 MCP_TOKEN');
  assert.equal(en('server returned EHOSTUNREACH'), 'server returned EHOSTUNREACH');
  assert.equal(en('配置文本最长 24000 字符'), 'Configuration text must not exceed 24000 characters.');
});
