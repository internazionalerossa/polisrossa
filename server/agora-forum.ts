import {verifiedAgoraPr3} from './verified-pr2';
import type {PostgresDatabase} from './database';

const headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
const LIMIT=30;
function reply(body:unknown,status=200){return Response.json(body,{status,headers});}
const clean=(value:unknown,min:number,max:number):value is string=>
 typeof value==='string'&&value.trim()===value&&value.length>=min&&value.length<=max&&
 !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);

/**
 * Public Agorà discussion board. Contributions require verified node PR2 membership.
 * It does not grant PR2/PR3 status and deliberately has NO vote endpoint.
 * The account owner_id never leaves the server.
 */
export async function handleAgoraForum(request:Request,db:PostgresDatabase,userId:string|null,participationOpen=true):Promise<Response>{
 const url=new URL(request.url);
 if(url.pathname!=='/api/agora/forum')return reply({error:'Unknown forum'},404);
 if(request.method==='GET'){
  if([...url.searchParams.keys()].some(k=>k!=='offset')||url.searchParams.getAll('offset').length>1)
   return reply({error:'Invalid page'},400);
  const raw=url.searchParams.get('offset')??'0';
  if(!/^(0|[1-9][0-9]{0,2})$/.test(raw)||Number(raw)>300)return reply({error:'Invalid page'},400);
  try{
   const result=await db.prepare(
    'SELECT id::text AS id,author_alias,title,body,'+
    ' (EXTRACT(EPOCH FROM created_at)*1000)::bigint AS created_ms'+
    ' FROM agora_forum_topics WHERE space_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?')
    .bind('agora',LIMIT+1,Number(raw)).all();
   const rows=result.results.slice(0,LIMIT).map(row=>({
    id:String(row.id),author:String(row.author_alias),
    title:String(row.title),body:String(row.body),createdAt:Number(row.created_ms),
   }));
   let canParticipate=false;
   if(userId)try{canParticipate=await verifiedAgoraPr3(db.pool,userId);}catch{}
   return reply({spaceId:'agora',topics:rows,nextOffset:result.results.length>LIMIT?Number(raw)+LIMIT:null,
    authenticated:canParticipate,publication:'discussion-only'});
  }catch{return reply({error:'Forum temporarily unavailable'},503);}
 }
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 if(!participationOpen)return reply({error:'Le nuove discussioni sono chiuse su questa installazione.'},503);
 if(!userId)return reply({error:'Accedi per partecipare.'},401);
 if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')
  return reply({error:'Invalid origin'},403);
 if(url.search)return reply({error:'Unexpected parameters'},400);
 try{
  if(!await verifiedAgoraPr3(db.pool,userId))
   return reply({error:'Solo PR2 verificati del nodo Agorà possono partecipare.'},403);
 }catch{return reply({error:'Impossibile verificare i permessi PR2.'},503);}
 if(!request.headers.get('content-type')?.startsWith('application/json'))
  return reply({error:'JSON required'},415);
 let raw:string;
 try{raw=await request.text();}catch{return reply({error:'Invalid body'},400);}
 if(Buffer.byteLength(raw,'utf8')>6000)return reply({error:'Discussion too large'},413);
 let input:unknown;
 try{input=JSON.parse(raw);}catch{return reply({error:'Invalid JSON'},400);}
 if(!input||typeof input!=='object'||Array.isArray(input))return reply({error:'Invalid discussion'},400);
 const fields=input as Record<string,unknown>;
 if(Object.keys(fields).sort().join(',')!=='alias,body,title'||
    !clean(fields.alias,2,60)||!clean(fields.title,8,150)||!clean(fields.body,40,4000))
  return reply({error:'Completa alias, titolo e descrizione nei limiti indicati.'},400);
 try{
  // The guarded INSERT and the count share the same transaction. db.batch()
  // serializes quota writes with a PostgreSQL transaction advisory lock.
  const results=await db.batch([db.prepare(
   "INSERT INTO agora_forum_topics(space_id,author_id,author_alias,title,body)"+
   " SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM agora_forum_topics"+
   " WHERE author_id=? AND created_at>now()-interval '1 day') < 6"+
   " RETURNING id::text AS id")
   .bind('agora',userId,fields.alias,fields.title,fields.body,userId)]);
  const row=results[0]?.results[0] as {id?:string}|undefined;
  if(!row?.id)return reply({error:'Limite di sei discussioni al giorno raggiunto.'},429);
  return reply({ok:true,id:String(row.id),spaceId:'agora',status:'published-discussion-not-vote'},201);
 }catch{return reply({error:'Il forum non è ancora disponibile su questo server.'},503);}
}
