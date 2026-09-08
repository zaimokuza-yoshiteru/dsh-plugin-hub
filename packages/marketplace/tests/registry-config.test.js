import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRegistry } from '../src/registry-config.js';

const nexus = 'https://nexus.example/repository/npm-group/';
test('explicit registry overrides local config without probing package managers', async () => {
  const run = async () => assert.fail('Explicit override should not read local config');
  assert.equal(await readRegistry(nexus.slice(0, -1), '/profile', { run }), nexus);
  for (const value of ['', null, 42, 'http://nexus.example/', 'https://user:secret@nexus.example/', 'https://nexus.example/?token=secret']) {
    await assert.rejects(readRegistry(value, '/profile', { run }), error => /registry/.test(error.message) && !error.message.includes('secret'));
  }
});

test('runtime uses pnpm profile config, preserving env overrides and disabling manager downloads', async () => {
  const calls = [];
  const run = async (...args) => { calls.push(args); return { stdout: `workspace warning\n${JSON.stringify(nexus)}\n` }; };
  assert.equal(await readRegistry(undefined, '/profile', { run, platform: 'win32', env: { npm_config_registry: nexus } }), nexus);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'pnpm.cmd');
  assert.deepEqual(calls[0][1], ['config', 'get', 'registry']);
  assert.equal(calls[0][2].cwd, '/profile');
  assert.equal(calls[0][2].env.npm_config_registry, nexus);
  assert.equal(calls[0][2].env.COREPACK_ENABLE_NETWORK, '0');
  assert.equal(calls[0][2].env.npm_config_manage_package_manager_versions, 'false');
});

test('missing pnpm falls back to npm; absent config defaults but invalid config never silently uses public npm', async () => {
  for (const missing of ['undefined\n', 'null\n', '', null]) {
    const calls = [];
    const run = async command => { calls.push(command); if (calls.length === 1) { if (missing === null) throw new Error('ENOENT'); return { stdout: missing }; } return { stdout: nexus }; };
    assert.equal(await readRegistry(undefined, '/profile', { run, platform: 'linux' }), nexus);
    assert.deepEqual(calls, ['pnpm', 'npm']);
  }
  assert.equal(await readRegistry(undefined, '/profile', { run: async () => { throw new Error('ENOENT'); } }), 'https://registry.npmjs.org/');
  await assert.rejects(readRegistry(undefined, '/profile', { run: async () => ({ stdout: 'not-a-registry' }) }), /registry/);
});

test('actual npm resolves profile, user and environment registry settings without network access', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-registry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const userconfig = join(dir, 'user.npmrc');
  await writeFile(userconfig, `registry=${nexus}\n`);
  await writeFile(join(dir, 'package.json'), '{"name":"registry-fixture","private":true}');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^npm_config_(registry|userconfig|globalconfig|global|location|prefix)$/i.test(key)) delete env[key];
  Object.assign(env, { npm_config_userconfig: userconfig, npm_config_globalconfig: join(dir, 'absent.npmrc') });
  const execute = promisify(execFile);
  const run = (command, args, options) => command.startsWith('pnpm') ? Promise.reject(new Error('ENOENT')) : execute(command, args, options);
  assert.equal(await readRegistry(undefined, dir, { run, env }), nexus);
  await writeFile(join(dir, '.npmrc'), 'registry=https://profile.example/npm/\n');
  assert.equal(await readRegistry(undefined, dir, { run, env }), 'https://profile.example/npm/');
  assert.equal(await readRegistry(undefined, dir, { run, env: { ...env, npm_config_registry: 'https://environment.example/npm/' } }), 'https://environment.example/npm/');
});
