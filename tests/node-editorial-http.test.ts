import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import type {Connections} from '../server/database';
import {newNodeDraft} from '../app/lib/node-studio-model';
import {createPublicSpaceSeed,validatePublicSpaceSeed} from '../app/platform/public-space-seed';
import {handleNodeEditorial,editorialPublicSpaceSeedResponse} from '../server/node-editorial-api';

test('HTTP node editorial lifecycle updates the readable thematic publication and rejects privilege spoofing',async()=>{
 const pg=new PGlite();
 try{
  await pg.exec(await readFile(new URL('../server/migrations/019-node-editorial-pr2.sql',import.meta.url),'utf8'));
  const conn={query:async(sql:string,args:unknown[]=[])=>{
   const x=await pg.query(sql,args);
   return {rows:x.rows as Record<string,unknown>[],rowCount:x.affectedRows};
  }};
  const pool={...conn,connect:async()=>conn} satisfies Connections;
  const verify=async(space:string,actor:string)=>space==='astronomia'&&['alice','bob'].includes(actor);
  const url='https://test.example/api/node-editorial?spaceId=astronomia';
  const request=(data:unknown,origin='https://test.example')=>new Request(url,{method:'POST',
   headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)});
  const call=(req:Request,user:string|null)=>handleNodeEditorial(req,pool,'astronomia',user,verify);
  const empty=await(await call(new Request(url),null)).json();
  assert.equal(empty.initialized,false);
  assert.equal((await call(request({action:'found'}),null)).status,401);
  assert.equal((await call(request({action:'found'},'https://evil.example'),'alice')).status,403);
  assert.equal((await call(request({action:'found',role:'pr3'}),'alice')).status,400);
  assert.equal((await call(request({action:'found'}),'mallory')).status,403);
  assert.equal((await call(request({action:'found'}),'alice')).status,201);
  const draft={...newNodeDraft('edit-node','astronomia'),
   name:'Astronomia',topic:'Ricerca e osservazione astronomica',
   description:'Una biblioteca di fonti e conoscenza astronomica verificabile.',
   blocks:[],sources:[]};
  const first=await call(request({action:'propose',draft,expectedBaseDigest:null}),'alice');
  assert.equal(first.status,201);
  assert.equal((await first.json()).status,'published');
  const seed=createPublicSpaceSeed({...draft,operation:'create-node'});
  const response=await editorialPublicSpaceSeedResponse(pool,seed);
  assert.equal(response.status,200);
  const publicNode=validatePublicSpaceSeed(await response.json());
  assert.equal(publicNode.name,'Astronomia');
  assert.equal(publicNode.publication.kind,'pr2-approved');
  assert.equal((await call(request({action:'join'}),'bob')).status,201);
  const collective=await(await call(new Request(url),'alice')).json();
  assert.equal(collective.mode,'collective');
  assert.equal(collective.members,2);
  const proposed=await(await call(request({action:'propose',draft:{...draft,description:'A second edition with reviewed bibliography and timeline.'},expectedBaseDigest:(await call(new Request(url),'alice').then(r=>r.json()) as {head:{digest:string}}).head.digest}),'alice')).json();
  assert.equal(proposed.status,'pending');
  assert.equal((await call(request({action:'vote',proposalId:proposed.id,choice:'yes',role:'pr3'}),'bob')).status,400);
  const firstVote=await(await call(request({action:'vote',proposalId:proposed.id,choice:'yes'}),'alice')).json();
  assert.equal(firstVote.status,'pending');
  const lastVote=await(await call(request({action:'vote',proposalId:proposed.id,choice:'yes'}),'bob')).json();
  assert.equal(lastVote.status,'published');
  const final=validatePublicSpaceSeed(await (await editorialPublicSpaceSeedResponse(pool,seed)).json());
  assert.match(final.description,/second edition/);
  const mismatch=await call(request({action:'propose',draft:{...draft,spaceId:'geologia'},expectedBaseDigest:null}),'alice');
  assert.equal(mismatch.status,403);
  assert.equal((await call(new Request(url.replace('astronomia','../secret')),null)).status,400);
 }finally{await pg.close();}
});
