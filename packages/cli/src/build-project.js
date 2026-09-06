import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { MARKET_PACKAGE, marketIdentity, normalizeBrand } from '@zaimokuza/dsh-plugin-hub/identity';
import { validateCatalog, PACKAGE_NAME } from '@zaimokuza/dsh-plugin-hub/catalog';
const require = createRequire(import.meta.url);
export async function buildProject(root) {
  const config = JSON.parse(await readFile(join(root,'hub.config.json'),'utf8'));
  const manifest = JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  const identity = marketIdentity(config.marketId);
  if (config.packageName !== manifest.name || !PACKAGE_NAME.test(manifest.name)) throw new Error('hub.config.json packageName must match package.json');
  if (!['market','source'].includes(config.kind)) throw new Error('Invalid project kind');
  const source = config.source;
  if (!['npm','json'].includes(source?.kind) || source.kind === 'npm' && !PACKAGE_NAME.test(source.packageName)) throw new Error('Invalid source');
  // Build only our outputs; never run source-supplied commands.
  await mkdir(join(root,'lib'),{recursive:true});
  const dataEntry = source.kind === 'json' ? `const catalog = JSON.parse(await readFile(new URL('./plugins.json', import.meta.url), 'utf8'));\n` : '';
  if (source.kind === 'json') { const catalog = validateCatalog(JSON.parse(await readFile(join(root,'plugins.json'),'utf8'))); await writeFile(join(root,'lib/plugins.json'),JSON.stringify(catalog,null,2)+'\n'); }
  else await rm(join(root,'lib/plugins.json'),{force:true});
  let code;
  if(config.kind === 'market') {
    const brand = normalizeBrand(config.brand);
    const registry = new URL(config.registry); if(registry.protocol !== 'https:' || registry.username || registry.password) throw new Error('Invalid registry');
    const defaults = { packageName:manifest.name, marketId:identity.id, brand, registry:registry.href, ...(source.kind === 'npm' ? { catalogPackage:source.packageName } : { catalogSources:[] }), demo:false };
    code = `import { createMarketplace } from '${MARKET_PACKAGE}/runtime';\n${source.kind === 'json' ? "import { readFile } from 'node:fs/promises';\n"+dataEntry : ''}const plugin = createMarketplace({ ...${JSON.stringify(defaults)}${source.kind === 'json' ? ', initialCatalog: catalog' : ''} });\nexport const name = plugin.name;\nexport const inject = plugin.inject;\nexport const apply = plugin.apply;\n`;
    await build({ entryPoints:[require.resolve(MARKET_PACKAGE+'/client-entry')],outfile:join(root,'lib/client.js'),bundle:true,format:'cjs',platform:'browser',target:'es2022',external:['react','react/jsx-runtime','@deepseek-ai/dsh-client-ui-primitives'],loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"',__HUB_PACKAGE__:JSON.stringify(manifest.name),__HUB_ID__:JSON.stringify(identity.id),__HUB_BRAND__:JSON.stringify(brand)},banner:{js:`window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`},footer:{js:'return module.exports; } });'} });
  } else {
    if(!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(config.sourceId) || typeof config.title !== 'string')throw new Error('Invalid source identity');
    code = `import { createSourcePlugin } from '${MARKET_PACKAGE}/source-plugin';\n${source.kind === 'json' ? "import { readFile } from 'node:fs/promises';\n" : ''}const plugin = createSourcePlugin({ ...${JSON.stringify({packageName:manifest.name,marketId:identity.id,id:config.sourceId,displayName:config.title,kind:source.kind,...(source.kind === 'npm' ? {catalogPackage:source.packageName} : {})})}${source.kind === 'json' ? ", getCatalog: async ({ signal }) => JSON.parse(await readFile(new URL('./plugins.json', import.meta.url), {encoding:'utf8',signal}))" : ''} });\nexport const name = plugin.name;\nexport const inject = plugin.inject;\nexport const apply = plugin.apply;\n`;
  }
  await writeFile(join(root,'lib/index.js'),code);
  console.log(`Built ${manifest.name}: lib/index.js${config.kind==='market'?', lib/client.js':''}`);
}
