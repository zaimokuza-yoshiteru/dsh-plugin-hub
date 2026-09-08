import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeRegistry } from './identity.js';

const runFile = promisify(execFile);
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';

/** Match the profile directory used by DSH's pnpm installer, without downloading tools. */
export async function readRegistry(explicit, cwd, { run = runFile, env = process.env, platform = process.platform } = {}) {
  if (explicit !== undefined) return normalizeRegistry(explicit);
  for (const manager of ['pnpm', 'npm']) {
    let output;
    try {
      const { stdout } = await run(platform === 'win32' ? `${manager}.cmd` : manager, ['config', 'get', 'registry'], {
        cwd, timeout: 5000, maxBuffer: 16384, windowsHide: true, shell: platform === 'win32',
        env: { ...env, COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_PROJECT_SPEC: '0',
          npm_config_manage_package_manager_versions: 'false', pnpm_config_manage_package_manager_versions: 'false' },
      });
      output = String(stdout).trim().split(/\r?\n/).at(-1);
    } catch { continue; }
    try { output = JSON.parse(output); } catch { /* npm commonly prints an unquoted URL. */ }
    if (output == null || output === '' || output === 'undefined' || output === 'null') continue;
    // A configured but invalid address is an error, not permission to query a public registry.
    return normalizeRegistry(output);
  }
  return DEFAULT_REGISTRY;
}
