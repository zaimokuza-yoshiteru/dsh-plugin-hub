import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const DEFAULT_MINUTES = 48 * 60;

export function parseReleaseAge(output) {
  // pnpm can print a workspace warning before the queried scalar.
  const line = String(output).trim().split(/\r?\n/).at(-1);
  let value;
  try { value = JSON.parse(line); } catch { value = line; }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value.trim());
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    && Number.isSafeInteger(value * 60000) && Date.now() + value * 60000 <= 8640000000000000 ? value : null;
}

/** Ask the locally installed pnpm for the config effective in the DSH profile. */
export async function readReleaseAge(cwd, { run = runFile, env = process.env, platform = process.platform } = {}) {
  let minutes = null;
  try {
    const { stdout } = await run(platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['config', 'get', 'minimumReleaseAge', '--json'], {
      cwd, timeout: 5000, maxBuffer: 16384, windowsHide: true, shell: platform === 'win32',
      // Config inspection must not download a different package manager.
      env: { ...env, COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_PROJECT_SPEC: '0',
        npm_config_manage_package_manager_versions: 'false', pnpm_config_manage_package_manager_versions: 'false' },
    });
    minutes = parseReleaseAge(stdout);
  } catch { /* Missing executable, unsupported command or timeout: use the fallback. */ }
  return { minimumAgeMinutes: minutes ?? DEFAULT_MINUTES, minimumAgeHours: (minutes ?? DEFAULT_MINUTES) / 60, releaseAgeSource: minutes === null ? 'default' : 'pnpm' };
}

export function releaseAgeArgument(config) {
  return `--config.minimumReleaseAge=${config.minimumAgeMinutes ?? Math.round(config.minimumAgeHours * 60)}`;
}
