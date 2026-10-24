import {createHash} from 'node:crypto';
import {canonicalKnowledgeJson} from '../app/lib/knowledge-model';
import type {Connection,Connections} from './database';

/**
 * Transactional node editorial state machine. This is a domain engine, not an
 * HTTP admission endpoint. Callers MUST authenticate the session and provide
 * an admission verifier backed by a valid node-specific PR2 credential.
 *
 * One PR2 -> sole member may publish a revision immediately.
 * Two or more PR2 -> proposal with a frozen electorate; majority required.
 * Concurrent proposals use compare-and-swap against the publication head.
 */
export type VerifyNodePr2=(spaceId:string,userId:string)=>boolean|Promise<boolean>;
type Decision='pending'|'published'|'rejected'|'stale';
const ID=/^[a-z][a-z0-9-]{2,47}$/;
const ACTOR=(s:string)=>s.length>=1&&s.length<=200;
const SHA=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');

export class EditorialError extends Error {
 constructor(readonly status:number,message:string){super(message);}
}
function validateIdentity(spaceId:string,userId:string){
 if(!ID.test(spaceId)||!ACTOR(userId))throw new EditorialError(400,'Invalid editorial identity');
}
async function transact<T>(pool:Connections,run:(connection:Connection)=>Promise<T>):Promise<T>{
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  // One lock serializes membership transitions and concurrent publication
  // decisions, including when API requests land on separate instances.
  await c.query('SELECT pg_advisory_xact_lock(194733,7)');
  const result=await run(c);
  await c.query('COMMIT');
  return result;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release?.();}
}
async function requireVerified(verify:VerifyNodePr2,spaceId:string,userId:string){
 if(!await verify(spaceId,userId))throw new EditorialError(403,'Verified PR2 membership is required');
}
async function requireMember(c:Connection,spaceId:string,userId:string){
 const result=await c.query('SELECT 1 FROM node_editorial_pr2 WHERE space_id=$1 AND user_id=$2',[spaceId,userId]);
 if(!result.rows.length)throw new EditorialError(403,'Active local PR2 membership required');
}
async function members(c:Connection,spaceId:string):Promise<string[]>{
 const result=await c.query('SELECT user_id FROM node_editorial_pr2 WHERE space_id=$1 ORDER BY joined_at,user_id',[spaceId]);
 return result.rows.map(r=>String(r.user_id));
}
async function spaceHead(c:Connection,spaceId:string){
 const r=await c.query('SELECT head_digest,head_sequence FROM node_editorial_spaces WHERE space_id=$1 FOR UPDATE',[spaceId]);
 if(!r.rows[0])throw new EditorialError(404,'Node not installed');
 return {digest:r.rows[0].head_digest===null?null:String(r.rows[0].head_digest),sequence:Number(r.rows[0].head_sequence)};
}
async function publish(c:Connection,spaceId:string,id:string,digest:string,body:string,base:string|null){
 const head=await spaceHead(c,spaceId);
 if(head.digest!==base){
  await c.query("UPDATE node_editorial_proposals SET status='stale',resolved_at=now() WHERE id=$1::uuid",[id]);
  return 'stale' as const;
 }
 const sequence=head.sequence+1;
 await c.query('INSERT INTO node_editorial_revisions(space_id,sequence,digest,content_json,proposal_id) VALUES($1,$2,$3,$4::jsonb,$5::uuid)',
  [spaceId,sequence,digest,body,id]);
 await c.query('UPDATE node_editorial_spaces SET head_digest=$1,head_sequence=$2 WHERE space_id=$3',[digest,sequence,spaceId]);
 await c.query("UPDATE node_editorial_proposals SET status='published',resolved_at=now() WHERE id=$1::uuid",[id]);
 return 'published' as const;
}
export async function initializeEditorialNode(
 pool:Connections,spaceId:string,founderId:string,verify:VerifyNodePr2,
):Promise<{mode:'solo';spaceId:string}>{
 validateIdentity(spaceId,founderId);await requireVerified(verify,spaceId,founderId);
 return transact(pool,async c=>{
  const current=await c.query('SELECT 1 FROM node_editorial_spaces WHERE space_id=$1',[spaceId]);
  if(current.rows.length)throw new EditorialError(409,'Node already has an editorial founder');
  await c.query('INSERT INTO node_editorial_spaces(space_id,founder_user_id) VALUES($1,$2)',[spaceId,founderId]);
  await c.query('INSERT INTO node_editorial_pr2(space_id,user_id) VALUES($1,$2)',[spaceId,founderId]);
  return {mode:'solo',spaceId};
 });
}
export async function joinEditorialPr2(
 pool:Connections,spaceId:string,userId:string,verify:VerifyNodePr2,
):Promise<{mode:'solo'|'collective';members:number}>{
 validateIdentity(spaceId,userId);await requireVerified(verify,spaceId,userId);
 return transact(pool,async c=>{
  await spaceHead(c,spaceId);
  await c.query('INSERT INTO node_editorial_pr2(space_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[spaceId,userId]);
  const electorate=await members(c,spaceId);
  if(electorate.length>1000)throw new EditorialError(409,'Editorial PR2 capacity reached');
  return {mode:electorate.length===1?'solo':'collective',members:electorate.length};
 });
}
export async function proposeEditorialRevision(
 pool:Connections,spaceId:string,userId:string,content:unknown,verify:VerifyNodePr2,
 expectedBaseDigest?:string|null,
):Promise<{id:string;digest:string;status:Decision;electorateSize:number}>{
 validateIdentity(spaceId,userId);await requireVerified(verify,spaceId,userId);
 const canonical=canonicalKnowledgeJson(content);
 if(canonical.length>60000||!content||Array.isArray(content)||typeof content!=='object')
  throw new EditorialError(400,'Editorial content must be a bounded object');
 const digest=SHA(canonical);
 return transact(pool,async c=>{
  await requireMember(c,spaceId,userId);
  const head=await spaceHead(c,spaceId),electorate=await members(c,spaceId);
  if(expectedBaseDigest!==undefined&&head.digest!==expectedBaseDigest)
   throw new EditorialError(409,'The published node changed; reload the latest revision before proposing edits');
  const inserted=await c.query(
   'INSERT INTO node_editorial_proposals(space_id,author_id,base_digest,content_digest,content_json,electorate_size)'+
   ' VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id::text',
   [spaceId,userId,head.digest,digest,canonical,electorate.length]);
  const id=String(inserted.rows[0].id);
  for(const actor of electorate)
   await c.query('INSERT INTO node_editorial_proposal_electors(proposal_id,user_id) VALUES($1::uuid,$2)',[id,actor]);
  const status:Decision=electorate.length===1?await publish(c,spaceId,id,digest,canonical,head.digest):'pending';
  return {id,digest,status,electorateSize:electorate.length};
 });
}
export async function voteEditorialProposal(
 pool:Connections,spaceId:string,userId:string,id:string,choice:'yes'|'no',verify:VerifyNodePr2,
):Promise<{status:Decision;yes:number;no:number;required:number}>{
 validateIdentity(spaceId,userId);
 if(!/^[0-9a-f-]{36}$/i.test(id)||!['yes','no'].includes(choice))throw new EditorialError(400,'Invalid vote');
 await requireVerified(verify,spaceId,userId);
 return transact(pool,async c=>{
  await requireMember(c,spaceId,userId);
  const result=await c.query(
   'SELECT id::text,base_digest,content_digest,content_json,electorate_size,status'+
   ' FROM node_editorial_proposals WHERE id=$1::uuid AND space_id=$2 FOR UPDATE',[id,spaceId]);
  const p=result.rows[0];
  if(!p)throw new EditorialError(404,'Proposal not found');
  if(p.status!=='pending')throw new EditorialError(409,'Proposal is no longer open');
  const elector=await c.query('SELECT 1 FROM node_editorial_proposal_electors WHERE proposal_id=$1::uuid AND user_id=$2',[id,userId]);
  if(!elector.rows.length)throw new EditorialError(403,'Not part of this frozen electorate');
  const saved=await c.query('INSERT INTO node_editorial_ballots(proposal_id,voter_id,choice) VALUES($1::uuid,$2,$3) ON CONFLICT DO NOTHING RETURNING choice',[id,userId,choice]);
  if(!saved.rows.length)throw new EditorialError(409,'An editorial ballot is already recorded');
  const counts=await c.query("SELECT COUNT(*) FILTER(WHERE choice='yes')::int AS yes,COUNT(*) FILTER(WHERE choice='no')::int AS no FROM node_editorial_ballots WHERE proposal_id=$1::uuid",[id]);
  const yes=Number(counts.rows[0].yes),no=Number(counts.rows[0].no);
  const required=Math.floor(Number(p.electorate_size)/2)+1;
  let status:Decision='pending';
  if(yes>=required)status=await publish(c,spaceId,id,String(p.content_digest),canonicalKnowledgeJson(p.content_json),p.base_digest===null?null:String(p.base_digest));
  else if(no>=required){
   await c.query("UPDATE node_editorial_proposals SET status='rejected',resolved_at=now() WHERE id=$1::uuid",[id]);
   status='rejected';
  }
  return {status,yes,no,required};
 });
}
export async function readEditorialHead(pool:Connections,spaceId:string){
 if(!ID.test(spaceId))throw new EditorialError(400,'Invalid node');
 const r=await pool.query('SELECT head_digest,head_sequence FROM node_editorial_spaces WHERE space_id=$1',[spaceId]);
 if(!r.rows[0])throw new EditorialError(404,'Node not installed');
 const body=await pool.query('SELECT content_json FROM node_editorial_revisions WHERE space_id=$1 AND sequence=$2',[spaceId,r.rows[0].head_sequence]);
 return {digest:r.rows[0].head_digest,sequence:Number(r.rows[0].head_sequence),content:body.rows[0]?.content_json??null};
}
