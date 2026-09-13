import test from 'node:test';
import assert from 'node:assert/strict';
import { experimentClient } from '../src/client/experiments.js';

const profile = { directory: '/desktop/current', installation: 'desktop' };
const row = { id: 'agent-teams', enabled: true, activeEnabled: true, installed: true, canToggle: true, busy: false, supported: true };
const snapshot = (feature = row) => ({ profile: profile.directory, features: [feature] });
const bridge = (overrides = {}) => ({ version: 1, list: async () => snapshot(), setEnabled: async () => ({ ok: true, value: snapshot(), reloadRequired: true }), ...overrides });
const request = async path => { assert.equal(path, 'experiments', 'Desktop must not write through Web RPC'); return [{ ...row, activeEnabled: null, canToggle: false, supported: false }]; };

test('Web uses its profile RPC even when a Desktop bridge is present', async () => {
  const calls = [];
  const client = experimentClient(async (...args) => { calls.push(args); return [row]; }, { experiments: bridge({ list: () => assert.fail('Desktop bridge called') }) }, () => assert.fail('Web reloaded'));
  const web = { ...profile, installation: 'cli' };
  assert.deepEqual(await client.list(web), [row]);
  await client.change(web, row, false);
  assert.deepEqual(calls[1], ['experiment-mutate', { profile: profile.directory, id: row.id, action: 'toggle', enabled: false, expectedEnabled: true }]);
});

test('Desktop reads host running state and reloads only after a verified successful result', async () => {
  const calls = [];
  const api = bridge({ setEnabled: async change => { calls.push(change); return { ok: true, value: snapshot({ ...row, enabled: false, activeEnabled: false }), reloadRequired: true }; } });
  const client = experimentClient(request, { experiments: api }, () => calls.push('reload'));
  const [feature] = await client.list(profile);
  assert.equal(feature.activeEnabled, true); assert.equal(feature.canToggle, true); assert.equal(feature.canInstall, false);
  await client.change(profile, feature, false);
  assert.deepEqual(calls, [{ profile: profile.directory, id: row.id, enabled: false, expectedEnabled: true }, 'reload']);
});

test('old, missing and unsupported Desktop bridges stay read-only', async () => {
  for (const api of [undefined, bridge({ version: 2 }), bridge({ list: async () => ({ profile: profile.directory, features: [] }) })]) {
    const client = experimentClient(request, { experiments: api }, () => assert.fail('unexpected reload'));
    const [feature] = await client.list(profile);
    assert.equal(feature.supported, false); assert.equal(feature.canToggle, false);
    await assert.rejects(client.change(profile, feature, false), /不支持/);
  }
});

test('Desktop rejects mismatched profiles, malformed state and install requests without falling back', async () => {
  for (const value of [{ profile: '/other', features: [row] }, snapshot({ ...row, activeEnabled: 'yes' }), { profile: profile.directory, features: [row, row] }]) {
    const client = experimentClient(request, { experiments: bridge({ list: async () => value }) }, () => assert.fail('unexpected reload'));
    await assert.rejects(client.list(profile));
  }
  const client = experimentClient(request, { experiments: bridge() }, () => assert.fail('unexpected reload'));
  await assert.rejects(client.change(profile, row, true, 'install'), /不支持/);
});

test('busy and failed transactions preserve errors and never reload or report success', async () => {
  for (const code of ['tasks-running', 'busy', 'state-changed', 'failed']) {
    const client = experimentClient(request, { experiments: bridge({ setEnabled: async () => ({ ok: false, error: { code } }) }) }, () => assert.fail('failure reloaded'));
    await assert.rejects(client.change(profile, row, false));
  }
  const client = experimentClient(request, { experiments: bridge({ setEnabled: async () => ({ ok: true, value: { profile: '/other', features: [row] }, reloadRequired: true }) }) }, () => assert.fail('wrong profile reloaded'));
  await assert.rejects(client.change(profile, row, false), /profile/);
});

test('Desktop state remains observable through IPC when the backend fails to restart', async () => {
  const api = bridge({ list: async () => snapshot({ ...row, enabled: false, activeEnabled: null }) });
  const client = experimentClient(() => assert.fail('Stopped backend cannot serve profile RPC'), { experiments: api }, () => {});
  const [feature] = await client.list(profile);
  assert.equal(feature.enabled, false);
  assert.equal(feature.activeEnabled, null);
  assert.equal(feature.canToggle, true);
});
