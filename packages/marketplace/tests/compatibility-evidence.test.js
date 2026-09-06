import test from 'node:test';import assert from 'node:assert/strict';
import {evaluateVersion,releaseList} from '../src/catalog.js';import {verifyNpmIdentity} from '../src/npm-identity.js';
const host={dsh:'0.1.2-rc.1',node:'22.19.0',platform:'darwin',arch:'arm64',peers:{'@deepseek-ai/dsh-session':'0.1.2-rc.1','@deepseek-ai/cordis':'4.0.2'}};
const when='2026-01-01T00:00:00Z',now=Date.parse('2026-09-06T00:00:00Z');
test('DSH peer declarations can establish compatibility without company-specific engines.dsh',()=>{
 const r=evaluateVersion('1.0.0',{peerDependencies:{'@deepseek-ai/dsh-session':'^0.1.2-rc.1'}},when,host,now,48);assert.equal(r.compatibility,'compatible');assert.equal(r.canInstall,true);assert.equal(r.compatibilityBasis,'peerDependencies');
 const none=evaluateVersion('1.0.0',{engines:{node:'>=22'},peerDependencies:{'@deepseek-ai/cordis':'^4.0.2'}},when,host,now,48);assert.equal(none.compatibility,'unknown');assert.equal(none.canInstall,false);
});
test('optional absent peers and unrelated versions never substitute for host evidence',()=>{
 const manifest={peerDependencies:{'@deepseek-ai/dsh-unknown':'^0.1.2-rc.1'},peerDependenciesMeta:{'@deepseek-ai/dsh-unknown':{optional:true}}};assert.equal(evaluateVersion('1.0.0',manifest,when,host,now).compatibility,'unknown');
 assert.equal(evaluateVersion('1.0.0',{peerDependencies:{'@deepseek-ai/dsh-session':'^0.1.0-rc.6'}},when,host,now).compatibility,'incompatible');
});
test('repository name collision blocks npm identity and version install eligibility',()=>{
 const plugin={verification:{},repositoryUrl:'https://github.com/team/plugin'};
 const metadata={'dist-tags':{latest:'1.0.0'},time:{'1.0.0':when},versions:{'1.0.0':{engines:{dsh:'0.1.2-rc.1'},repository:{url:'git+https://github.com/another/plugin.git'}}}};
 assert.throws(()=>verifyNpmIdentity(metadata,plugin),/不一致/);assert.equal(releaseList(metadata,host,now,48,plugin)[0].canInstall,false);
 metadata.versions['1.0.0'].repository.url='git+https://github.com/team/plugin.git';assert.doesNotThrow(()=>verifyNpmIdentity(metadata,plugin));assert.equal(releaseList(metadata,host,now,48,plugin)[0].canInstall,true);
});
