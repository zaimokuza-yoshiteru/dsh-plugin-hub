import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const frontendModules = ['@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots'];
// Official tag a66e470: packages/client/web/src/seed.ts and the three package manifests.
// Published frontends bundle these modules and do not install their devDependencies.
const verifiedFrontendReleases = { '0.1.2-rc.1': Object.fromEntries(frontendModules.map(name => [name, '0.1.2-rc.1'])) };

export function collectHostPeers(entryManifest) {
  const peers = {}, queue = [entryManifest], visited = new Set();
  let frontend;
  while (queue.length) {
    const file = queue.shift(); let manifest;
    try { manifest = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    if (visited.has(manifest.name)) continue;
    visited.add(manifest.name);
    if (manifest.name.startsWith('@deepseek-ai/')) peers[manifest.name] = manifest.version;
    if (manifest.name === '@deepseek-ai/dsh-web-frontend') frontend = { file, version: manifest.version };
    const resolver = createRequire(file);
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }).filter(name => name.startsWith('@deepseek-ai/'))) {
      try { queue.push(resolver.resolve(name + '/package.json')); } catch { /* Unavailable packages stay unknown. */ }
    }
  }
  if (frontend) {
    const resolver = createRequire(frontend.file);
    for (const name of frontendModules) {
      if (peers[name]) continue;
      try { peers[name] = JSON.parse(readFileSync(resolver.resolve(name + '/package.json'), 'utf8')).version; }
      catch { if (verifiedFrontendReleases[frontend.version]?.[name]) peers[name] = verifiedFrontendReleases[frontend.version][name]; }
    }
  }
  return peers;
}
