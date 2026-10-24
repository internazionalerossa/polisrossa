import type {PostgresDatabase} from './database';
import {verifiedAgoraPr3} from './verified-pr2';

/**
 * Account identity comes only from a verified server session.
 * The credential verification queries are intentionally fail-closed.
 * Advisory ballots here DO NOT publish content, grant PR2 or enact policy.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE=new Set(['agora','agoranode']);
const HEADERS={'cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:HEADERS});
const text=(v:unknown,min:number,max:number):v is string=>
 typeof v==='string'&&v.trim()===v&&v.length>=min&&v.length<=max&&!/[\u0000-\u001f]/.test(v);

/**
 * PR3 is the platform-level function of an active PR2 of the Agorà founding node.
 * No distinct appointment, hosting entitlement or platform ballot weight is created.
 * Membership must have entered this store through signed attestation validation.
 */

export async function handleScopedIssues(
 request:Request,db:PostgresDatabase,userId:string|null,now=Date.now(),
):Promise<Response>{
 const url=new URL(request.url),scope=url.searchParams.get('scope');
 if(!scope||!SCOPE.has(scope)||url.searchParams.getAll('scope').length!==1||
   [...url.searchParams.keys()].some(k=>!['scope','issueId'].includes(k)))
  return reply({error:'Invalid scope'},400);
 const rawId=url.searchParams.get('issueId');
 if(rawId!==null&&(!UUID.test(rawId)||url.searchParams.getAll('issueId').length!==1))
  return reply({error:'Invalid issue'},400);
 if(request.method==='GET'){
  // Capability is derived from the server-side session and verified PR2 status,
  // never from client role selectors. The board remains readable to visitors.
  let canParticipate=false;
  if(userId)try{canParticipate=await verifiedAgoraPr3(db.pool,userId,now);}catch{}
  try {
   if(rawId){
    const issue=await db.pool.query(
     "SELECT id::text,scope,title,body,status,created_at FROM agora_internal_issues WHERE id=$1::uuid AND scope=$2",[rawId,scope]);
    if(!issue.rows[0])return reply({error:'Issue not found'},404);
    const comments=await db.pool.query(
     "SELECT id::text,body,created_at FROM agora_internal_issue_comments WHERE issue_id=$1::uuid ORDER BY created_at,id LIMIT 100",[rawId]);
    const tally=await db.pool.query(
     "SELECT choice,COUNT(*)::int AS count FROM agora_internal_issue_votes WHERE issue_id=$1::uuid GROUP BY choice",[rawId]);
    return reply({issue:issue.rows[0],comments:comments.rows,advisoryVotes:tally.rows,binding:false,canParticipate});
   }
   const rows=await db.pool.query(
    "SELECT id::text,scope,title,body,status,created_at FROM agora_internal_issues WHERE scope=$1 ORDER BY created_at DESC,id DESC LIMIT 60",[scope]);
   return reply({scope,issues:rows.rows,binding:false,canParticipate});
  }catch{return reply({error:'Issues unavailable'},503);}
 }
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 if(!userId)return reply({error:'Authentication required'},401);
 if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')
  return reply({error:'Invalid origin'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))
  return reply({error:'JSON required'},415);
 let data:unknown;
 try {
  const raw=await request.text();
  if(Buffer.byteLength(raw,'utf8')>12_000)return reply({error:'Payload too large'},413);
  data=JSON.parse(raw);
 }catch{return reply({error:'Invalid JSON'},400);}
 if(!data||typeof data!=='object'||Array.isArray(data))return reply({error:'Invalid action'},400);
 const v=data as Record<string,unknown>;
 if(!['create','comment','vote'].includes(String(v.action)))return reply({error:'Invalid action'},400);
 if(Object.keys(v).some(k=>!['action','title','body','issueId','choice'].includes(k)))
  return reply({error:'Unknown fields'},400);
 const id=typeof v.issueId==='string'?v.issueId:'';
 try{
  if(v.action==='create'){
   if(rawId!==null||!text(v.title,8,160)||!text(v.body,20,8000)||v.issueId!==undefined||v.choice!==undefined)
    return reply({error:'Invalid issue content'},400);
   if(!await verifiedAgoraPr3(db.pool,userId,now))return reply({error:'Active, verified Agorà PR2 membership required (PR3 is its platform function)'},403);
   const rows=await db.batch([db.prepare(
    "INSERT INTO agora_internal_issues(scope,author_id,title,body) SELECT ?,?,?,?"+
    " WHERE (SELECT COUNT(*) FROM agora_internal_issues WHERE author_id=? AND created_at>now()-interval '1 day')<10"+
    " RETURNING id::text").bind(scope,userId,v.title,v.body,userId)]);
   const created=rows[0]?.results[0];
   return created?reply({ok:true,id:created.id,scope},201):reply({error:'Daily issue limit reached'},429);
  }
  if(!UUID.test(id)||rawId!==null&&rawId!==id)return reply({error:'Invalid issue'},400);
  const issue=await db.pool.query("SELECT status FROM agora_internal_issues WHERE id=$1::uuid AND scope=$2",[id,scope]);
  if(!issue.rows[0])return reply({error:'Issue not found'},404);
  if(issue.rows[0].status!=='open')return reply({error:'Issue closed'},409);
  if(v.action==='comment'){
   if(!await verifiedAgoraPr3(db.pool,userId,now))return reply({error:'Only verified Agorà PR2 members may comment on internal issues'},403);
   if(!text(v.body,5,4000)||v.title!==undefined||v.choice!==undefined)return reply({error:'Invalid comment'},400);
   const inserted=await db.batch([db.prepare(
    "INSERT INTO agora_internal_issue_comments(issue_id,author_id,body) SELECT ?,?,?"+
    " WHERE (SELECT COUNT(*) FROM agora_internal_issue_comments WHERE author_id=? AND created_at>now()-interval '1 day')<50"+
    " RETURNING id::text").bind(id,userId,v.body,userId)]);
   const row=inserted[0]?.results[0];
   return row?reply({ok:true,id:row.id},201):reply({error:'Daily comment limit reached'},429);
  }
  if(v.title!==undefined||v.body!==undefined||!['yes','no','abstain'].includes(String(v.choice)))
   return reply({error:'Invalid advisory vote'},400);
  if(!await verifiedAgoraPr3(db.pool,userId,now))return reply({error:'Active, verified Agorà PR2 membership required (PR3 is its platform function)'},403);
  await db.prepare("INSERT INTO agora_internal_issue_votes(issue_id,voter_id,choice) VALUES(?,?,?)"+
   " ON CONFLICT(issue_id,voter_id) DO UPDATE SET choice=excluded.choice,updated_at=now()")
   .bind(id,userId,v.choice).run();
  return reply({ok:true,binding:false,notice:'Advisory opinion only; not a binding governance decision'});
 }catch{return reply({error:'Issue service temporarily unavailable'},503);}
}
