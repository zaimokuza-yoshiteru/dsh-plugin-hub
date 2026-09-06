import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReleaseAge, readReleaseAge, releaseAgeArgument } from '../src/release-age.js';
import { evaluateVersion } from '../src/catalog.js';

test('pnpm release age preserves valid zero/minutes and rejects invalid values', () => {
  for (const [value, expected] of [['0', 0], ['1440', 1440], ['"90"', 90], ['WARN workspace\n30\n', 30]]) assert.equal(parseReleaseAge(value), expected);
  for (const value of ['', 'undefined', 'null', 'false', '-1', '1.5', '{}', '[]', 'NaN', 'Infinity', '9007199254740991', '48h']) assert.equal(parseReleaseAge(value), null, value);
});

test('read local pnpm config without downloading a package manager; failures fall back to 48 hours', async () => {
  const run = async (command, args, options) => {
    assert.equal(command, 'pnpm'); assert.deepEqual(args, ['config', 'get', 'minimumReleaseAge', '--json']);
    assert.equal(options.cwd, '/test/profile'); assert.equal(options.shell, false);
    assert.equal(options.env.COREPACK_ENABLE_NETWORK, '0'); assert.equal(options.env.pnpm_config_manage_package_manager_versions, 'false');
    assert.equal(options.timeout, 5000); return { stdout: '90\n' };
  };
  assert.deepEqual(await readReleaseAge('/test/profile', { run, platform: 'linux', env: {} }), { minimumAgeMinutes: 90, minimumAgeHours: 1.5, releaseAgeSource: 'pnpm' });
  for (const run of [async () => ({ stdout: 'invalid' }), async () => { throw new Error('ENOENT'); }, async () => { throw new Error('timeout'); }]) {
    assert.deepEqual(await readReleaseAge('/test/profile', { run }), { minimumAgeMinutes: 2880, minimumAgeHours: 48, releaseAgeSource: 'default' });
  }
});

test('pnpm zero and fractional hours use identical age boundaries and installation minutes', async () => {
  const host = { dsh: '0.1.2-rc.1', node: '22.19.0', peers: {} };
  const manifest = { engines: { dsh: host.dsh } };
  const published = '2026-09-01T00:00:00Z', start = Date.parse(published);
  for (const minutes of [0, 1, 31, 90, 1440, 4320]) {
    const policy = await readReleaseAge('.', { run: async () => ({ stdout: String(minutes) }) });
    assert.equal(releaseAgeArgument(policy), `--config.minimumReleaseAge=${minutes}`);
    assert.equal(evaluateVersion('1.0.0', manifest, published, host, start + minutes * 60000, policy.minimumAgeHours).canInstall, true);
    assert.equal(evaluateVersion('1.0.0', manifest, published, host, start + minutes * 60000 - 1, policy.minimumAgeHours).canInstall, false);
  }
});
