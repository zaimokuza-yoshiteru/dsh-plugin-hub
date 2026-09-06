import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{Marketplace}from'../src/service.js';
test('large catalog stays complete while metadata loads only for visible requests',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hub-large-'));let queries=0;
 const plugins=Array.from({length:301},(_,i)=>({packageName:'dsh-p'+i,displayName:'Plugin '+i,description:'Test',owner:'Team',origin:'community',tags:['developer-tools']}));
 const market=new Marketplace({config:{sources:[],cacheDir:dir,registry:'https://registry.test/',minimumAgeHours:48},host:{dsh:'0.1.2-rc.1',node:'22.19.0',peers:{}},installer:{installed:async()=>({})},fetcher:async()=>{queries++;return new Response(JSON.stringify({versions:{'1.0.0':{engines:{dsh:'0.1.2-rc.1'}}},time:{'1.0.0':'2026-01-01T00:00:00Z'}}));}});
 try{market.providers.registerSource({id:'all',kind:'json',getCatalog:async()=>({schemaVersion:1,plugins})},{primary:true});await market.init();let state=await market.snapshot();assert.equal(state.plugins.length,301);assert.equal(queries,40);assert.equal(state.lazyMetadata,true);assert.equal(state.metadataProgress.done,40);
 await Promise.all([market.loadReleases(['dsh-p300']),market.loadReleases(['dsh-p300'])]);state=await market.snapshot();assert.equal(queries,41);assert.equal(state.plugins[300].recommendedVersion,'1.0.0');assert.equal(state.plugins[299].metadataLoading,true);await assert.rejects(market.loadReleases(Array(41).fill('dsh-p1')),/Invalid/);
 }finally{await market.close();await rm(dir,{recursive:true,force:true});}
});
