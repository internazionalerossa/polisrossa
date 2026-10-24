import {nodeStudioDraft} from '../app/lib/node-studio-model';
import {
 PR2_APPROVED_NOTICE,validatePublicSpaceSeed,type PublicSpaceSeed,
} from '../app/platform/public-space-seed';
import type {Connections} from './database';
import {
 EditorialError,initializeEditorialNode,joinEditorialPr2,
 proposeEditorialRevision,readEditorialHead,voteEditorialProposal,
 type VerifyNodePr2,
} from './node-editorial-governance';

const ID=/^[a-z][a-z0-9-]{2,47}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});

/**
 * Real transactional editorial API: the caller supplies a single-node DB pool,
 * session user ID and trusted credential verifier. It must never be invoked
 * with a client-declared role or unvalidated node ID.
 */
export async function handleNodeEditorial(
 request:Request,pool:Connections,spaceId:string,userId:string|null,verify:VerifyNodePr2,
):Promise<Response>{
 if(!ID.test(spaceId)||['agora','polisrossa'].includes(spaceId))
  return reply({error:'Unknown editable node'},404);
 const url=new URL(request.url);
 if(url.pathname!=='/api/node-editorial')return reply({error:'Unknown editorial endpoint'},404);
 if(url.searchParams.getAll('spaceId').length!==1||url.searchParams.get('spaceId')!==spaceId)
  return reply({error:'Invalid query'},400);
 if(request.method==='GET'){
  if([...url.searchParams.keys()].some(key=>key!=='spaceId'||url.searchParams.getAll(key).length!==1))
   return reply({error:'Invalid query'},400);
  try{
   const head=await readEditorialHead(pool,spaceId);
   const proposals=await pool.query(
    "SELECT id::text,content_digest,content_json,electorate_size,status,created_at"+
    " FROM node_editorial_proposals WHERE space_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 30",[spaceId]);
   const count=await pool.query('SELECT COUNT(*)::int AS count FROM node_editorial_pr2 WHERE space_id=$1',[spaceId]);
   return reply({spaceId,initialized:true,mode:Number(count.rows[0].count)<2?'solo':'collective',
    members:Number(count.rows[0].count),head,proposals:proposals.rows});
  }catch(e){if(e instanceof EditorialError&&e.status===404)
   return reply({spaceId,initialized:false,mode:'uninitialized',members:0,head:null,proposals:[]});
   return reply({error:'Editorial service unavailable'},503);}
 }
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 if(!userId)return reply({error:'Sign in to participate'},401);
 if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')
  return reply({error:'Invalid origin'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))
  return reply({error:'JSON required'},415);
 if(url.searchParams.get('spaceId')!==spaceId||url.searchParams.getAll('spaceId').length!==1||
   [...url.searchParams.keys()].some(key=>key!=='spaceId'))return reply({error:'Invalid query'},400);
 let payload:unknown;
 try{
  const raw=await request.text();
  if(Buffer.byteLength(raw,'utf8')>64_000)return reply({error:'Payload too large'},413);
  payload=JSON.parse(raw);
 }catch{return reply({error:'Invalid JSON'},400);}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return reply({error:'Invalid request'},400);
 const data=payload as Record<string,unknown>;
 try{
  if(data.action==='found'){
   if(Object.keys(data).sort().join(',')!=='action')return reply({error:'Invalid founding action'},400);
   return reply(await initializeEditorialNode(pool,spaceId,userId,verify),201);
  }
  if(data.action==='join'){
   if(Object.keys(data).sort().join(',')!=='action')return reply({error:'Invalid admission action'},400);
   return reply(await joinEditorialPr2(pool,spaceId,userId,verify),201);
  }
  if(data.action==='propose'){
   if(Object.keys(data).sort().join(',')!=='action,draft,expectedBaseDigest'||
     !(data.expectedBaseDigest===null||
       (typeof data.expectedBaseDigest==='string'&&/^sha256:[0-9a-f]{64}$/.test(data.expectedBaseDigest))))
    return reply({error:'A valid published base revision is required'},400);
   const draft=nodeStudioDraft(data.draft);
   if(draft.spaceId!==spaceId)return reply({error:'Draft belongs to another node'},403);
   const publicContent={
    spaceId:draft.spaceId,name:draft.name,topic:draft.topic,
    description:draft.description,accent:draft.accent,
    sources:draft.sources,blocks:draft.blocks,
   };
   return reply(await proposeEditorialRevision(pool,spaceId,userId,publicContent,verify,data.expectedBaseDigest as string|null),201);
  }
  if(data.action==='vote'){
   if(Object.keys(data).sort().join(',')!=='action,choice,proposalId'||
      typeof data.proposalId!=='string'||!UUID.test(data.proposalId)||
      !['yes','no'].includes(String(data.choice)))return reply({error:'Invalid vote'},400);
   return reply(await voteEditorialProposal(pool,spaceId,userId,data.proposalId,data.choice as 'yes'|'no',verify));
  }
  return reply({error:'Unknown editorial action'},400);
 }catch(e){
  if(e instanceof EditorialError)return reply({error:e.message},e.status);
  if(e instanceof Error&&/Invalid node blueprint|Invalid node source|Invalid node content|Empty node block|exceeds storage/i.test(e.message))
   return reply({error:'Invalid node content'},400);
  return reply({error:'Editorial operation unavailable'},503);
 }
}

/** Installed seeds become live read-only content after approved PR2 revisions. */
export async function editorialPublicSpaceSeedResponse(
 pool:Connections,seed:PublicSpaceSeed,
):Promise<Response>{
 try {
  const head=await readEditorialHead(pool,seed.spaceId);
  if(head.sequence===0)return Response.json(seed,{headers});
  const data=head.content;
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Corrupt publication');
  const record=data as Record<string,unknown>;
  const result=validatePublicSpaceSeed({
   ...seed,spaceId:seed.spaceId,
   name:record.name,topic:record.topic,description:record.description,accent:record.accent,
   sources:record.sources,blocks:record.blocks,
   publication:{kind:'pr2-approved',notice:PR2_APPROVED_NOTICE},
  });
  return Response.json(result,{headers});
 }catch(e){
  if(e instanceof EditorialError&&e.status===404)
   return Response.json(seed,{headers});
  return reply({error:'The editorial publication is temporarily unavailable'},503);
 }
}
