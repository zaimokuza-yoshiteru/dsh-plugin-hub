import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/generate.js';
import { buildProject } from '../src/build-project.js';
const runtime = JSON.parse(await readFile(new URL('../../marketplace/package.json', import.meta.url), 'utf8'));
const options={name:'@company/market',registry:'https://nexus.example/repository/npm-group/',datasource:'npm:@company/catalog','market-id':'example',title:'example','sub-title':'DEVELOPER TOOLS','primary-color':'red','publish-registry':'https://nexus.example/repository/npm-hosted/'};
test('enterprise market builds with isolated client identity and pinned dependencies',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hub-cli-'));try{
 const dir=join(root,'market'); await generate('create-market',dir,options); await buildProject(dir);
 const p=JSON.parse(await readFile(join(dir,'package.json')));const code=await readFile(join(dir,'lib/index.js'),'utf8');const client=await readFile(join(dir,'lib/client.js'),'utf8');
 assert.equal(p.scripts.prepack,'npm run build');assert.equal(p.dependencies['@zaimokuza/dsh-plugin-hub'],runtime.version);assert.match(code,/"demo":false/);assert.match(code,/@company\/catalog/);assert.match(client,/id: "@company\/market"/);assert.match(client,/example/);assert.doesNotMatch(code,/github\.com/);
 await assert.rejects(generate('create-market',dir,options),/already exists/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('JSON child builds and npm child references a separate catalog package',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hub-source-'));try{
 const catalog={schemaVersion:1,plugins:[{packageName:'@company/search',displayName:'Search',description:'Find docs',tags:['knowledge']}]};
 const json=join(root,'plugins.json');await writeFile(json,JSON.stringify(catalog));
 const dir=join(root,'source');await generate('create-source',dir,{...options,name:'@company/source',datasource:'file:'+json,'source-id':'team'});await buildProject(dir);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'lib/plugins.json'))),catalog);
 assert.match(await readFile(join(dir,'lib/index.js'),'utf8'),/"marketId":"example"/);
 const other=join(root,'npm-source');await generate('create-source',other,{...options,name:'@company/source-npm'});await buildProject(other);assert.match(await readFile(join(other,'lib/index.js'),'utf8'),/"kind":"npm"/);
 const local=join(root,'local-market');await generate('create-market',local,{...options,datasource:'file:'+json});await buildProject(local);assert.match(await readFile(join(local,'lib/index.js'),'utf8'),/initialCatalog: catalog/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('catalog verification flows from CLI options and edited config into built market defaults', async t => {
 const root=await mkdtemp(join(tmpdir(),'hub-verification-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const dir=join(root,'market');await generate('create-market',dir,{...options,'catalog-verification':'required'});
 const configFile=join(dir,'hub.config.json');const config=JSON.parse(await readFile(configFile,'utf8'));
 assert.equal(config.catalogVerification,'required');
 for(const policy of ['required','none',undefined]){
  config.catalogVerification=policy;await writeFile(configFile,JSON.stringify(config));await buildProject(dir);
  assert((await readFile(join(dir,'lib/index.js'),'utf8')).includes(`"catalogVerification":"${policy??'if-present'}"`));
 }
 await assert.rejects(generate('create-source',join(root,'source'),{...options,'catalog-verification':'none'}),/target market/);
});
test('bad inputs fail before creating a project',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hub-invalid-'));try{for(const change of [{name:'bad name'},{'market-id':'../x'},{registry:'http://example.com'},{'primary-color':'url(https://example.com)'},{datasource:'https://github.com/x'},{'catalog-verification':'typo'}])await assert.rejects(generate('create-market',join(root,'bad'),{...options,...change}));}finally{await rm(root,{recursive:true,force:true});}
});
