import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { c } from 'tar';
import { collectHostPeers } from '../src/host-peers.js';
import { evaluateVersion } from '../src/catalog.js';
import { Marketplace } from '../src/service.js';
import * as child from '../../source-demo/src/index.js';
const host = { dsh: '0.1.2-rc.1', node: '22.19.0', platform: 'darwin', arch: 'arm64', peers: {} };
const check = manifest => evaluateVersion('1.0.0', manifest, '2026-01-01T00:00:00Z', host, Date.parse('2026-09-06T00:00:00Z'));

test('market/source policies allow future prereleases without weakening other declarations or install safeguards', async () => {
  for (const path of ['../package.json', '../../source-demo/package.json']) {
    const manifest = JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
    assert.equal(manifest.engines.dsh, undefined);
    for (const dsh of ['0.1.2-rc.1', '0.1.2', '0.1.3-alpha.1', '0.2.0-rc.1', '1.0.0-beta.1', '2.0.0']) {
      assert.equal(evaluateVersion('1.0.0', manifest, '2026-01-01', { ...host, dsh }, Date.parse('2026-09-06')).canInstall, true, dsh);
    }
    assert.equal(check({ ...manifest, engines: { ...manifest.engines, dsh: '<0.1.0' } }).canInstall, false);
    assert.equal(check({ ...manifest, engines: { node: '>=24' } }).canInstall, false);
    assert.equal(check({ ...manifest, peerDependencies: { '@deepseek-ai/dsh-removed-api': '*' } }).canInstall, false);
    assert.equal(check({ ...manifest, dsh: { compatibility: { dshReleases: { [host.dsh]: 'incompatible' } } } }).canInstall, false);
    assert.equal(evaluateVersion('1.0.0', manifest, '2026-09-06', host, Date.parse('2026-09-06')).canInstall, false);
  }
  assert.equal(check({}).compatibility, 'unknown');
  assert.equal(check({ engines: { dsh: '*' } }).compatibility, 'incompatible');
});

test('missing required host APIs fail explicitly before marketplace initialization', async () => {
  const { apply } = await import('../src/index.js');
  const valid = { connection: { requestRejection() {} }, webServer: { register() {} }, provide() {}, effect() {} };
  for (const missing of ['connection', 'webServer', 'provide', 'effect']) {
    await assert.rejects(apply({ ...valid, [missing]: undefined }), new RegExp('required DSH API ' + missing));
  }
});

test('author formats, conflicts, negative release declarations and prerelease rules stay distinct', () => {
  assert.equal(check({ dsh: { engines: { dsh: '>=0.1.2-alpha.2' } } }).compatibility, 'compatible');
  assert.equal(check({ dsh: { compatibility: { dshReleases: { [host.dsh]: 'compatible' } } } }).compatibility, 'compatible');
  assert.equal(check({ dsh: { compatibility: { dshReleases: { [host.dsh]: 'incompatible' } } } }).compatibility, 'incompatible');
  assert.equal(check({ engines: { dsh: '>=0.1.1-rc.1' }, dsh: { compatibility: { dshReleases: { [host.dsh]: 'compatible' } } } }).compatibility, 'unknown');
  assert.equal(check({ dsh: { engines: { dsh: '>=0.1.1-rc.1' } } }).compatibility, 'incompatible');
  assert.equal(check({ dsh: { compatibility: { dsh: host.dsh, node: '>=24' } } }).canInstall, false);
  assert.equal(check({ dsh: { compatibility: { dsh: host.dsh, profiles: ['desktop'] } } }).canInstall, false);
});

test('published frontend versions resolve only verified built-ins, never arbitrary devDependencies', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-host-')); t.after(() => rm(dir, {recursive:true,force:true}));
  const frontend = join(dir, 'node_modules/@deepseek-ai/dsh-web-frontend'); await mkdir(frontend,{recursive:true});
  const entry=join(dir,'package.json');
  await writeFile(entry, JSON.stringify({name:'@deepseek-ai/dsh',version:host.dsh,dependencies:{'@deepseek-ai/dsh-web-frontend':host.dsh}}));
  const file=join(frontend,'package.json');await writeFile(file,JSON.stringify({name:'@deepseek-ai/dsh-web-frontend',version:host.dsh,devDependencies:{'@deepseek-ai/dsh-fictional':host.dsh}}));
  const peers=collectHostPeers(entry);assert.equal(peers['@deepseek-ai/dsh-client-ui-primitives'],host.dsh);assert.equal(peers['@deepseek-ai/dsh-fictional'],undefined);
  await writeFile(file,JSON.stringify({name:'@deepseek-ai/dsh-web-frontend',version:'9.0.0'}));assert.equal(collectHostPeers(entry)['@deepseek-ai/dsh-client-ui-primitives'],undefined);
});

test('a source plugin is installable from the main catalog, then adds a tab and overrides duplicates until removed', async t => {
  const dir=await mkdtemp(join(tmpdir(),'hub-source-install-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const main=JSON.parse(await readFile(new URL('../../catalog/plugins.json',import.meta.url),'utf8'));
  const catalog=JSON.parse(await readFile(new URL('../../source-catalog-demo/plugins.json',import.meta.url),'utf8'));
  const sourceEntry=main.plugins.find(p=>p.packageName===child.name);assert(sourceEntry);
  const duplicate={...catalog.plugins[0],description:'Primary description'};
  const packageDir=join(dir,'package');await mkdir(packageDir);await writeFile(join(packageDir,'plugins.json'),JSON.stringify(catalog));
  const chunks=[];for await(const chunk of c({gzip:true,cwd:dir},['package/plugins.json']))chunks.push(chunk);const bytes=Buffer.concat(chunks);
  const dataName='@zaimokuza/dsh-plugin-hub-source-catalog-demo';const registry='https://registry.example.test/';
  const metadata={name:child.name,'dist-tags':{latest:'0.1.0'},repository:sourceEntry.repositoryUrl,time:{'0.1.0':'2026-01-01T00:00:00Z'},versions:{'0.1.0':{engines:{dsh:host.dsh},repository:sourceEntry.repositoryUrl}}};
  const fetcher=async url=>{
    const path=decodeURIComponent(new URL(url).pathname.slice(1));
    if(path===child.name)return Response.json(metadata);
    if(path===dataName)return Response.json({'dist-tags':{latest:'0.1.0'},versions:{'0.1.0':{dist:{tarball:registry+'catalog.tgz',integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')}}}});
    if(path==='catalog.tgz')return new Response(bytes);
    return new Response('',{status:404});
  };
  const installed={};const installer={installed:async()=>({...installed}),install:async(name,version)=>{installed[name]=version;},uninstall:async name=>{delete installed[name];}};
  const market=new Marketplace({config:{cacheDir:dir,registry,minimumAgeHours:48,sources:[{id:'main',kind:'json',getCatalog:async()=>({schemaVersion:1,plugins:[sourceEntry,duplicate]})}]},host,fetcher,installer});t.after(()=>market.close());await market.init();
  const wait=async job=>{for(let n=0;n<100&&['queued','installing'].includes(job.status);n++)await new Promise(r=>setTimeout(r,10));assert.equal(job.status,'completed',job.error);};
  await wait(await market.enqueue(child.name,'0.1.0'));
  assert.equal((await market.snapshot()).plugins.find(p=>p.packageName===child.name).installedVersion,'0.1.0');
  assert.equal(market.providers.snapshot().sources.length,1,'source loads only after DSH activates the installed plugin');
  let dispose;child.apply({dshPluginHub_hub:{apiVersion:1,registerSource:source=>market.providers.registerSource(source)},effect:fn=>{dispose=fn();}});
  await market.refresh();const state=await market.snapshot();
  assert.equal(state.sources.find(s=>s.id==='zaimokuza').count,2);
  assert.equal(state.plugins.filter(p=>p.packageName===duplicate.packageName).length,1);
  assert.equal(state.plugins.find(p=>p.packageName===duplicate.packageName).description,catalog.plugins[0].description);
  await wait(await market.enqueue(child.name,undefined,'uninstall'));dispose();await market.refresh();
  assert.equal((await market.snapshot()).sources.some(s=>s.id==='zaimokuza'),false);
  assert.equal(market.plugins.find(p=>p.packageName===duplicate.packageName).description,'Primary description');
});
