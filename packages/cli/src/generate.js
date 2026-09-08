import { mkdir, writeFile, readFile, access, rename, rm } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PACKAGE_NAME, validateCatalog } from '@zaimokuza/dsh-plugin-hub/catalog';
import { MARKET_PACKAGE, marketIdentity, normalizeBrand, catalogVerification } from '@zaimokuza/dsh-plugin-hub/identity';
const own = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const runtime = JSON.parse(await readFile(new URL('../../marketplace/package.json', import.meta.url)).catch(async () => {
  const { createRequire } = await import('node:module'); return readFile(createRequire(import.meta.url).resolve(MARKET_PACKAGE + '/package.json'));
}));
export async function generate(kind, directory, options) {
  if (!['create-market','create-source'].includes(kind)) throw new Error('Use create-market or create-source');
  if (!PACKAGE_NAME.test(options.name ?? '') || options.name.length > 214 || [MARKET_PACKAGE, own.name].includes(options.name)) throw new Error('Choose a valid, distinct --name for the generated package');
  const target = resolve(directory);
  try { await access(target); throw new Error('Output directory already exists; choose a new directory'); } catch(error) { if(error.code !== 'ENOENT') throw error; }
  const identity = marketIdentity(options['market-id'] ?? 'enterprise');
  const value = options.datasource ?? '';
  let catalog;
  let source;
  if (value.startsWith('npm:') && PACKAGE_NAME.test(value.slice(4))) source = { kind: 'npm', packageName: value.slice(4) };
  else if (value.startsWith('file:')) { catalog = validateCatalog(JSON.parse(await readFile(resolve(value.slice(5)), 'utf8'))); source = { kind: 'json' }; }
  else throw new Error('--datasource must be npm:<package> or file:<JSON path>');
  const https = value => { const url = new URL(value); if(url.protocol !== 'https:' || url.username || url.password) throw new Error('Registry must be HTTPS without credentials'); return url.href.replace(/\/?$/, '/'); };
  if (kind === 'create-market' && !options.registry) throw new Error('--registry is required for an enterprise market');
  if (kind === 'create-source' && options['catalog-verification'] !== undefined) throw new Error('--catalog-verification belongs to the target market');
  const brand = normalizeBrand({ title: options.title ?? 'Enterprise', subTitle: options['sub-title'] ?? 'PLUGIN HUB', navTitle: options.title ?? 'Enterprise Market', primaryColor: options['primary-color'] ?? 'red' });
  const sourceId = options['source-id'] ?? 'team-' + identity.id;
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(sourceId)) throw new Error('Invalid --source-id');
  const config = { kind: kind === 'create-market' ? 'market' : 'source', packageName: options.name, marketId: identity.id, ...(kind === 'create-market' ? { brand, registry: https(options.registry), catalogVerification: catalogVerification(options['catalog-verification']) } : { sourceId, title: options.title ?? 'Team catalog' }), source };
  const manifest = { name: options.name, version: '0.1.0', type: 'module', main: './lib/index.js', files: ['lib','cordis.patch.yml','README.md'], exports: { '.': './lib/index.js', './package.json': './package.json', ...(config.kind === 'market' ? { './client': './lib/client.js' } : {}) }, scripts: { build: 'node scripts/build.mjs', prepack: 'npm run build' }, engines: runtime.engines, dshPluginHub: runtime.dshPluginHub, dependencies: { [MARKET_PACKAGE]: runtime.version }, devDependencies: { [own.name]: own.version }, dsh: { bundle: { patch: './cordis.patch.yml' }, ...(config.kind === 'market' ? { client: runtime.dsh.client } : {}) }, ...(options['publish-registry'] ? { publishConfig: { registry: https(options['publish-registry']) } } : {}) };
  const temp = join(dirname(target), '.' + basename(target) + '-' + randomUUID());
  await mkdir(temp, { recursive: true });
  try {
    await mkdir(join(temp, 'scripts'));
    for (const [file, data] of [['package.json',manifest],['hub.config.json',config],...(catalog ? [['plugins.json',catalog]] : [])]) await writeFile(join(temp,file),JSON.stringify(data,null,2)+'\n');
    await writeFile(join(temp,'scripts/build.mjs'), await readFile(new URL('../templates/build.mjs', import.meta.url)));
    await writeFile(join(temp,'cordis.patch.yml'), `- insert:\n    - id: ${JSON.stringify(options.name)}\n      name: ${JSON.stringify(options.name)}\n`);
    await writeFile(join(temp,'.gitignore'),'node_modules/\nlib/\n*.tgz\n');
    await writeFile(join(temp,'README.md'), `# ${options.name}\n\n为市场 ID \`${identity.id}\` 生成的 ${config.kind} 项目。\n\n运行 \`npm install\`、\`npm run build\`、\`npm pack\`；构建结果位于 lib/，tgz 包含插件入口、DSH patch 和选用的本地 JSON。修改 hub.config.json 后重新构建；npm 数据包更新仅需刷新市场。\n\n安装到 DSH 后手动重启。子来源需与目标市场安装在同一 profile。默认不按 DSH 版本号拦截（包括预发行版）；必要接口缺失时会报错。已测试宿主版本见 package.json 的 dshPluginHub.testedDshVersions。\n\nGenerated ${config.kind} for market ID \`${identity.id}\`.\n\nRun \`npm install\`, \`npm run build\` and \`npm pack\`. Build outputs are in lib/; the tarball includes plugin entries, the DSH patch and local JSON when selected. Edit hub.config.json and rebuild to change configuration; npm catalog updates only need a market refresh.\n\nRestart DSH after installing. A source and its target market must share a profile. DSH versions, including prereleases, are not gated by version number; missing required APIs fail at runtime. Tested hosts are recorded under dshPluginHub.testedDshVersions in package.json. Runtime and builder dependencies are pinned.\n`);
    await rename(temp,target);
  } catch(error) { await rm(temp,{recursive:true,force:true}); throw error; }
  return `Generated ${config.kind}: ${target}\nNext: npm install, npm run build, npm pack.`;
}
