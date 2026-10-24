import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PostgresDatabase,type Connections} from '../server/database';
import {handleScopedIssues} from '../server/scoped-issues';

test('the issue service is scoped, authenticated, and never grants PR2 by self declaration',async()=>{
 const pg=new PGlite();
 try {
  await pg.exec(await readFile(new URL('../server/migrations/014-federation-pr3.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../server/migrations/018-scoped-internal-issues.sql',import.meta.url),'utf8'));
  const connection={query:async(sql:string,args:unknown[]=[])=>{
   const v=await pg.query(sql,args);
   return {rows:v.rows as Record<string,unknown>[],rowCount:v.affectedRows};
  }};
  const db=new PostgresDatabase({...connection,connect:async()=>connection} satisfies Connections);
  const url='https://example.test/api/scoped-issues?scope=agora';
  const post=(data:unknown,origin='https://example.test')=>
   new Request(url,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(data)});
  const details={action:'create',title:'Improve our source library',body:'The bibliography needs stable references with explicit provenance and reviewer decisions.'};
  assert.equal((await handleScopedIssues(post(details),db,null)).status,401);
  assert.equal((await handleScopedIssues(post(details,'https://evil.test'),db,'alice')).status,403);
  assert.equal((await handleScopedIssues(post(details),db,'alice')).status,403);
  // A verified node credential is created only by the separate authenticated
  // federation-attestation process, never by a user-supplied role flag.
  const digest='sha256:'+'a'.repeat(64);
  await pg.query('INSERT INTO federation_nodes(node_id,display_name,admitted_by_decision_digest,admitted_at) VALUES($1,$2,$3,$4)',
    ['agora','Agorà',digest,1]);
  await pg.query('INSERT INTO federation_node_keys(node_id,key_id,public_key_spki_base64,valid_from,admitted_by_decision_digest,valid_until) VALUES($1,$2,$3,$4,$5,$6)',
    ['agora','sha256:'+'b'.repeat(64),'A'.repeat(64),1,digest,1800000000001]);
  await pg.query('INSERT INTO federation_pr2_electors(owner_key,actor_id,source_node_id,source_membership_id,voter_key_id,voter_public_key_spki_base64,public_alias,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    ['alice','actor-alice','agora','sha256:'+'c'.repeat(64),'sha256:'+'d'.repeat(64),'A'.repeat(64),'Alice',1]);
  const now=1_800_000_000_000;
  await pg.query('INSERT INTO federation_pr2_attestations(attestation_sha256,owner_key,source_node_id,source_membership_id,issuer_key_id,proof_json,attestation_json,valid_from,valid_until,accepted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    ['sha256:'+'e'.repeat(64),'alice','agora','sha256:'+'c'.repeat(64),'sha256:'+'b'.repeat(64),
     JSON.stringify({state:'active',nodeId:'agora'}),'{}',now-1000,now+100000,now-1000]);
  const boardAuthorized=await (await handleScopedIssues(new Request(url),db,'alice',now)).json();
  assert.equal(boardAuthorized.canParticipate,true);
  const boardPr1=await (await handleScopedIssues(new Request(url),db,'bob',now)).json();
  assert.equal(boardPr1.canParticipate,false);
  const boardRevoked=await (await handleScopedIssues(new Request(url),db,'alice',now+100001)).json();
  assert.equal(boardRevoked.canParticipate,false);
  const created=await handleScopedIssues(post(details),db,'alice',now);
  assert.equal(created.status,201);
  assert.equal((await handleScopedIssues(post(details),db,'alice',now+100001)).status,403);
  const platformRequest=new Request('https://example.test/api/scoped-issues?scope=agoranode',{
   method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},
   body:JSON.stringify(details),
  });
  assert.equal((await handleScopedIssues(platformRequest,db,'alice',now)).status,201);
  assert.equal((await handleScopedIssues(new Request('https://example.test/api/scoped-issues?scope=agoranode',{
   method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},
   body:JSON.stringify(details),
  }),db,'alice',now+100001)).status,403);

  const issueId=crypto.randomUUID();
  await pg.query('INSERT INTO agora_internal_issues(id,scope,author_id,title,body) VALUES ($1,$2,$3,$4,$5)',
   [issueId,'agora','alice',details.title,details.body]);
  const list=await (await handleScopedIssues(new Request(url),db,null)).json();
  assert.equal(list.issues.length,2);
  assert.equal(list.issues[0].scope,'agora');
  assert.ok(!JSON.stringify(list).includes('alice'));
  const separate=await (await handleScopedIssues(new Request('https://example.test/api/scoped-issues?scope=agoranode'),db,null)).json();
  assert.equal(separate.issues.length,1);
  const detail=await (await handleScopedIssues(new Request(url+'&issueId='+issueId),db,null)).json();
  assert.equal(detail.issue.id,issueId);
  assert.equal(detail.binding,false);
  assert.equal((await handleScopedIssues(post({action:'vote',issueId,choice:'yes'}),db,'alice')).status,403);
  assert.equal((await handleScopedIssues(post({action:'comment',issueId,body:'Please publish verifiable bibliography links.'}),db,'bob')).status,403);
  const message=await handleScopedIssues(post({action:'comment',issueId,body:'Please publish verifiable bibliography links.'}),db,'alice',now);
  assert.equal(message.status,201);
  const comments=await (await handleScopedIssues(new Request(url+'&issueId='+issueId),db,null)).json();
  assert.equal(comments.comments.length,1);
  assert.equal(comments.advisoryVotes.length,0);
  assert.ok(!JSON.stringify(comments).includes('bob'));
  assert.equal((await handleScopedIssues(new Request(url+'&issueId=bad'),db,null)).status,400);
  // Revoking the admitted issuer key must immediately revoke issue rights,
  // even before the member's own attestation expires.
  assert.equal((await handleScopedIssues(post(details),db,'alice',now+2)).status,403);
  const revokedBoard=await (await handleScopedIssues(new Request(url),db,'alice',now+2)).json();
  assert.equal(revokedBoard.canParticipate,false);

 }finally{await pg.close();}
});
