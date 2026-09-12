import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findMcpDefinition, deleteMcpDefinition, atomicWrite } from '../src/profile-files.js';
import { Experiments } from '../src/experiments.js';

test('delete removes the owned MCP definition while preserving other rows, comments and credentials references', async t => {
 const profile = await realpath(await mkdtemp(join(tmpdir(), 'hub-delete-'))); t.after(() => rm(profile, { recursive: true, force: true }));
 const file = join(profile, 'cordis.patch.yml');
 await writeFile(file, '# keep this comment\n- insert:\n    - id: owned\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: one\n    - id: keep\n      name: other\n      config:\n        token: !!js process.env.TOKEN\n');
 let removed;
 const entry = { options: { id: 'owned' }, parent: { tree: { filename: file }, remove: async id => { removed = id; } } };
 assert(await findMcpDefinition(profile, entry));
 await deleteMcpDefinition(profile, entry);
 const result = await readFile(file, 'utf8'); assert.doesNotMatch(result, /id: owned/); assert.match(result, /keep this comment/); assert.match(result, /!!js "?process.env.TOKEN/); assert.equal(removed, 'owned');
 assert.equal(await findMcpDefinition(join(profile, 'another-profile'), entry), null);
});

test('Agent Teams toggles only this profile bundles, keeps installed dependencies and reports restart requirement', async t => {
 const profile = await realpath(await mkdtemp(join(tmpdir(), 'hub-experiment-'))); t.after(() => rm(profile, { recursive: true, force: true }));
 const bundles = ['@deepseek-ai/dsh-experimental-agent-team-profile', '@deepseek-ai/dsh-experimental-agent-team-web-profile'];
 for (const name of bundles) { const dir = join(profile, 'node_modules', name); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' })); }
 const file = join(profile, 'package.json'); await writeFile(file, JSON.stringify({ dependencies: Object.fromEntries(bundles.map(name => [name, '1.0.0'])), dsh: { profile: { bundles: ['base', ...bundles] } } }));
 const experiments = new Experiments({ profileDir: profile, installation: 'cli' }); assert.equal((await experiments.snapshot())[0].enabled, true);
 await assert.rejects(experiments.mutate({ id: 'agent-teams', profile: '/other', enabled: false }), /实例/);
 await experiments.mutate({ id: 'agent-teams', profile, enabled: false });
 const saved = JSON.parse(await readFile(file, 'utf8')); assert.deepEqual(saved.dsh.profile.bundles, ['base']); assert.equal(Object.keys(saved.dependencies).length, 2);
 assert.equal((await experiments.snapshot())[0].pendingRestart, true);
});

test('Desktop Agent Teams does not infer disabled from an unavailable native preference', async t => {
 const profile = await realpath(await mkdtemp(join(tmpdir(), 'hub-desktop-experiment-'))); t.after(() => rm(profile, { recursive: true, force: true }));
 const file = join(profile, 'package.json'); await writeFile(file, JSON.stringify({ dsh: { profile: { bundles: [] } } }));
 const experiments = new Experiments({ profileDir: profile, installation: 'desktop' });
 const [row] = await experiments.snapshot(); assert.equal(row.enabled, null); assert.equal(row.canToggle, false); assert.equal(row.canInstall, false);
 await assert.rejects(experiments.mutate({ id: 'agent-teams', profile, enabled: true }), /Desktop/);
 assert.equal(JSON.parse(await readFile(file, 'utf8')).dsh.desktop, undefined);
 await writeFile(file, JSON.stringify({ dsh: { desktop: { agentTeams: false } } }));
 assert.equal((await experiments.snapshot())[0].enabled, false);
});

test('failed atomic replacement removes its temporary file and preserves the existing target', async t => {
 const directory = await mkdtemp(join(tmpdir(), 'hub-atomic-')); t.after(() => rm(directory, { recursive: true, force: true }));
 const target = join(directory, 'target'); await mkdir(target);
 await assert.rejects(atomicWrite(target, 'private configuration'));
 assert.deepEqual(await readdir(directory), ['target']);
});
