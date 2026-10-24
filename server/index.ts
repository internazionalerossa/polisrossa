import {socialIdentityEndpoint,verifiedApplicationSocialIdentity,allowedIdentityCallback,unlinkFacebookIdentity} from './social-identity';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {serviceInfoResponse} from '../app/lib/service-info';
import {isAppShellPath} from '../app/lib/site-routing';
import {configuration} from './config';
import {createPool,connections} from './pool';
import {PostgresDatabase} from './database';
import {createAuth,authSession,accountEndpoint} from './auth';
import {liveChat} from './live-chat';
import {purgeForumApplications,startForumApplicationRetention} from './forum-retention';
import {purgeAuthenticationState,startAuthenticationRetention} from './auth-retention';
import {api,privatePaths} from './api';
import {verifiedNodePr2} from './verified-pr2';
import {publicSpaceSeedResponse,publicSpaceDirectoryResponse} from './public-space-registry';
import {publicSpaceFeedResponse} from './public-space-feed';
import {databaseTarget,openSpaceDatabaseRegistry} from './space-databases';
import {handleNodeEditorial,editorialPublicSpaceSeedResponse} from './node-editorial-api';
import {handleNodeForum} from './node-forum';
import {handleNodeBookmarks} from './node-bookmarks';
import {handleNodeChat} from './node-chat';
import {handleAgoraNodeFoundations} from './agora-node-foundations';
import {migrateNodeEditorialDatabase} from './node-editorial-migrations';
import {publicSpaceKnowledgeResponse} from './public-space-knowledge';
import type {ForumSocialIdentity} from '../app/lib/forum';
import {INSTANCE_NAME,INSTANCE_PLATFORM_NAME} from '../app/lib/instance';
const config=configuration(),pool=createPool(config.connectionString),db=new PostgresDatabase(connections(pool));
const {auth,settle}=createAuth(pool,config),root=resolve(dirname(fileURLToPath(import.meta.url)),'public');
// Optional, server-only local read pools. These credentials are NEVER sent to the browser.
const extraSpaceInputs=process.env.AGORANODE_PUBLIC_SPACE_DATABASES_JSON
 ? JSON.parse(process.env.AGORANODE_PUBLIC_SPACE_DATABASES_JSON) as Array<{spaceId:string;connectionString:string}>
 : [];
if(!Array.isArray(extraSpaceInputs)||extraSpaceInputs.length>16)throw Error('Invalid public space database configuration');
const publicSpacePools=extraSpaceInputs.length
 ? openSpaceDatabaseRegistry(extraSpaceInputs,connectionString=>createPool(connectionString,2))
 : null;
const editorialSpaceInputs=process.env.AGORANODE_EDITORIAL_SPACE_DATABASES_JSON
 ? JSON.parse(process.env.AGORANODE_EDITORIAL_SPACE_DATABASES_JSON) as Array<{spaceId:string;connectionString:string}>
 : [];
if(!Array.isArray(editorialSpaceInputs)||editorialSpaceInputs.length>16)
 throw Error('Invalid editorial database configuration');
const publicTargets=new Map(extraSpaceInputs.map(entry=>[entry.spaceId,databaseTarget(entry.connectionString)]));
for(const entry of editorialSpaceInputs){
 if(!entry||typeof entry.spaceId!=='string'||typeof entry.connectionString!=='string'||
    publicTargets.get(entry.spaceId)!==databaseTarget(entry.connectionString)||
    databaseTarget(entry.connectionString)===databaseTarget(config.connectionString))
  throw Error('Every editorial writer must target its matching independent thematic database');
}
const editorialSpacePools=editorialSpaceInputs.length
 ? openSpaceDatabaseRegistry(editorialSpaceInputs,connectionString=>createPool(connectionString,2))
 : null;
const verifyNodePr2=(spaceId:string,userId:string)=>verifiedNodePr2(pool,spaceId,userId);

const jobs=new Set<Promise<unknown>>();
const background=(promise:Promise<unknown>)=>{const job=promise.catch(()=>{}).finally(()=>jobs.delete(job));jobs.add(job);};
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
async function staticResponse(pathname:string){
 let decoded:string;try{decoded=decodeURIComponent(pathname);}catch{return new Response('Not found',{status:404});}
 if(decoded.includes('\0')||decoded.includes('\\'))return new Response('Not found',{status:404});
 const filename=isAppShellPath(decoded)?resolve(root,'index.html'):resolve(root,'.'+decoded);
 if(!filename.startsWith(root+sep))return new Response('Not found',{status:404});
 try{if(!(await stat(filename)).isFile())throw Error();return new Response(await readFile(filename),{headers:{'content-type':types[extname(filename)]??'application/octet-stream','cache-control':filename.endsWith('index.html')||decoded==='/sw.js'?'no-cache':decoded.startsWith('/assets/')?'public, max-age=31536000, immutable':'public, max-age=3600'}});}catch{return new Response('Not found',{status:404});}
}
const server=createServer({maxHeaderSize:16384,requestTimeout:30000,headersTimeout:15000},async(incoming,outgoing)=>{
 try{
  const method=incoming.method??'GET',url=new URL(incoming.url??'/',config.origin);
  if(url.origin!==config.origin){outgoing.writeHead(400).end();return;}
  let body:Uint8Array|undefined;
  if(!['GET','HEAD'].includes(method)){const chunks:Buffer[]=[];let bytes=0;for await(const chunk of incoming){bytes+=chunk.length;if(bytes>(url.pathname==='/api/community/chat'?2900000:160000)){outgoing.writeHead(413).end();return;}chunks.push(chunk);}body=Buffer.concat(chunks);}
  const headers=new Headers();for(const [key,value]of Object.entries(incoming.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
  // Identity headers are never consulted. The canonical origin is configuration, never forwarded host input.
  const request=new Request(url,{method,headers,body:body as BodyInit|undefined});
  let response:Response;
  const spaceFeed=/^\/api\/public-spaces\/([a-z][a-z0-9-]{2,47})\/feed$/.exec(url.pathname);
  const spaceKnowledge=/^\/api\/public-spaces\/([a-z][a-z0-9-]{2,47})\/(knowledge|search)$/.exec(url.pathname);
  if(spaceFeed){
   const id=spaceFeed[1];
   const manifest=await publicSpaceSeedResponse(
    new Request(config.origin+'/api/public-spaces/'+id),
    process.env.AGORANODE_PUBLIC_SPACES_DIRECTORY,
   );
   if(!manifest.ok)response=Response.json({error:'Thematic node not installed'},{status:404});
   else response=await publicSpaceFeedResponse(request,
     await manifest.json() as import('../app/platform/public-space-seed').PublicSpaceSeed);
  }
  else if(spaceKnowledge){
   const id=spaceKnowledge[1];
   const seed=await publicSpaceSeedResponse(
    new Request(config.origin+'/api/public-spaces/'+id),
    process.env.AGORANODE_PUBLIC_SPACES_DIRECTORY,
   );
   if(seed.status!==200||!publicSpacePools?.ids().includes(id)){
    response=Response.json({error:'Knowledge node not installed'},{status:404,headers:{'cache-control':'no-store'}});
   }else response=await publicSpaceKnowledgeResponse(request,connections(publicSpacePools.get(id)),id);
  }
  else if(url.pathname==='/api/agora/foundations'){
   if(config.mirror&&method!=='GET')response=Response.json({error:'Read-only mirror'},{status:403});
   else{
    const session=await authSession(auth,request);
    response=session.finish(await handleAgoraNodeFoundations(request,connections(pool),session.user?.id??null));
   }
  }
  else if(url.pathname==='/api/public-spaces')response=await publicSpaceDirectoryResponse(request,process.env.AGORANODE_PUBLIC_SPACES_DIRECTORY);
  else if(url.pathname.startsWith('/api/public-spaces/')){
   const installed=await publicSpaceSeedResponse(request,process.env.AGORANODE_PUBLIC_SPACES_DIRECTORY);
   const id=/^\/api\/public-spaces\/([a-z][a-z0-9-]{2,47})$/.exec(url.pathname)?.[1];
   if(installed.ok&&id&&editorialSpacePools?.ids().includes(id)){
    const seed=await installed.json() as import('../app/platform/public-space-seed').PublicSpaceSeed;
    response=await editorialPublicSpaceSeedResponse(connections(editorialSpacePools.get(id)),seed);
   }else response=installed;
  }
  else if(url.pathname==='/api/node-editorial'||url.pathname==='/api/node-forum'||url.pathname==='/api/node-bookmarks'||url.pathname==='/api/node-chat'){
   const ids=url.searchParams.getAll('spaceId');
   const id=ids.length===1?ids[0]:'';
   if(!/^[a-z][a-z0-9-]{2,47}$/.test(id)||['agora','polisrossa'].includes(id))
    response=Response.json({error:'Invalid editorial node'},{status:400});
   else if(!editorialSpacePools?.ids().includes(id))
    response=Response.json({error:'Editorial database not configured'},{status:503});
   else{
    const installed=await publicSpaceSeedResponse(new Request(config.origin+'/api/public-spaces/'+id),process.env.AGORANODE_PUBLIC_SPACES_DIRECTORY);
    if(!installed.ok)response=Response.json({error:'Node is not installed'},{status:404});
    else if(config.mirror&&method!=='GET')response=Response.json({error:'Read-only mirror'},{status:403});
    else{
     const session=await authSession(auth,request);
     const editorPool=connections(editorialSpacePools.get(id));
     response=session.finish(url.pathname==='/api/node-editorial'
      ?await handleNodeEditorial(request,editorPool,id,session.user?.id??null,verifyNodePr2)
      :url.pathname==='/api/node-forum'
       ?await handleNodeForum(request,editorPool,id,session.user?.id??null,verifyNodePr2)
       :url.pathname==='/api/node-chat'
        ?await handleNodeChat(request,editorPool,id,session.user?.id??null,verifyNodePr2)
       :await handleNodeBookmarks(request,editorPool,
        await installed.json() as import('../app/platform/public-space-seed').PublicSpaceSeed,session.user?.id??null));
    }
   }
  }
  else if(url.pathname==='/api/service-info')response=serviceInfoResponse(request,config.operator,config.registrationOpen,config.forumOpen,config.mirror);
  else if(url.pathname==='/healthz'){
   try{await pool.query('SELECT 1');response=Response.json({ok:true},{headers:{'cache-control':'no-store'}});}catch{response=Response.json({ok:false},{status:503,headers:{'cache-control':'no-store'}});}
  }else if(config.mirror&&url.pathname==='/api/agora/forum'&&method!=='GET')response=Response.json({error:'Sola consultazione'},{status:403,headers:{'cache-control':'no-store'}});
  else if(config.mirror&&(url.pathname==='/api/auth'||url.pathname.startsWith('/api/identity/')||url.pathname==='/api/community/identity'||privatePaths.has(url.pathname)))response=Response.json({configured:false,authenticated:false,registrationOpen:false,error:'Questa copia pubblica non ospita account o dati privati.'},{status:url.pathname==='/api/auth'&&method==='GET'?200:403,headers:{'cache-control':'private, no-store'}});
  else if(url.pathname==='/api/auth')response=await accountEndpoint(auth,request,connections(pool),config.registrationOpen,config);
  else if(url.pathname==='/api/community/identity')response=await socialIdentityEndpoint(auth,request,config);
  else if(url.pathname.startsWith('/api/identity/')){
   const allowed=method==='GET'&&((config.mailTransport!=='none'&&(url.pathname==='/api/identity/verify-email'||url.pathname.startsWith('/api/identity/reset-password/')))||allowedIdentityCallback(url.pathname,method,config));
   response=allowed?await auth.handler(request):new Response('Not found',{status:404});
  }else if(url.pathname.startsWith('/api/')){
   if(privatePaths.has(url.pathname)||url.pathname==='/api/agora/forum'){const session=await authSession(auth,request);let socialIdentity:ForumSocialIdentity=null,unlinkIdentity:(()=>Promise<void>)|undefined;
    if(session.user&&url.pathname==='/api/community/forum'&&method==='POST'&&request.headers.get('origin')===config.origin&&request.headers.get('sec-fetch-site')!=='cross-site'){let input:unknown;try{input=await request.clone().json();}catch{}const data=input&&!Array.isArray(input)&&typeof input==='object'?input as Record<string,unknown>:null,action=data?.action;if(action==='apply'&&config.forumOpen)socialIdentity=()=>verifiedApplicationSocialIdentity(auth,request,config,data);if(action==='apply'||action==='cancelApplication')unlinkIdentity=()=>unlinkFacebookIdentity(auth,request);}
    response=session.finish(await api(request,db,session.user?.id??null,config.bootstrapHash,background,config.forumOpen,socialIdentity,unlinkIdentity,Boolean(session.user)));}
   else response=await api(request,db,null,config.bootstrapHash,background,config.forumOpen);
  }else response=['GET','HEAD'].includes(method)?await staticResponse(url.pathname):new Response('Method not allowed',{status:405});
  outgoing.setHeader('x-content-type-options','nosniff');outgoing.setHeader('referrer-policy','no-referrer');outgoing.setHeader('x-frame-options','DENY');outgoing.setHeader('permissions-policy','camera=(), microphone=(), geolocation=()');outgoing.setHeader('strict-transport-security','max-age=31536000');
  for(const [key,value]of response.headers)if(key!=='set-cookie')outgoing.setHeader(key,value);
  const cookies=response.headers.getSetCookie();if(cookies.length)outgoing.setHeader('set-cookie',cookies);
  outgoing.statusCode=response.status;
  if(method==='HEAD'||!response.body)outgoing.end();else Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).on('error',()=>outgoing.destroy()).pipe(outgoing);
 }catch{if(!outgoing.headersSent){outgoing.writeHead(503,{'content-type':'application/json','cache-control':'private, no-store'}).end(JSON.stringify({error:'Servizio temporaneamente non disponibile.'}));}else outgoing.destroy();}
});
// Clear expired chat memory even when nobody is polling; no persistence on shutdown.
const chatCleanup=setInterval(()=>liveChat.sweep(),1000);chatCleanup.unref();
const forumRetention=startForumApplicationRetention(()=>background(purgeForumApplications(db).then(count=>console.info(`Forum application retention completed: ${count} removed`)).catch(error=>{console.error('Forum application retention failed');throw error;})));
const authRetention=startAuthenticationRetention(()=>background(purgeAuthenticationState(db).then(result=>console.info(`Authentication retention completed: ${result.sessions+result.verifications+result.limits+result.unverifiedUsers+result.facebookGrants} removed`)).catch(error=>{console.error('Authentication retention failed');throw error;})));
void Promise.all(editorialSpaceInputs.map(item=>migrateNodeEditorialDatabase(connections(editorialSpacePools!.get(item.spaceId)))))
 .then(()=>server.listen(config.port,'0.0.0.0',()=>console.info(`${INSTANCE_PLATFORM_NAME} instance ${INSTANCE_NAME} server ready`)))
 .catch(async(error:unknown)=>{
  console.error('Editorial schema initialization failed; refusing to accept traffic',error instanceof Error?error.message:'Unknown error');
  await Promise.allSettled([pool.end(),publicSpacePools?.close(),editorialSpacePools?.close()]);
  process.exitCode=1;
 });
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(chatCleanup);clearInterval(forumRetention as ReturnType<typeof setInterval>);clearInterval(authRetention as ReturnType<typeof setInterval>);server.close(()=>{void Promise.allSettled([...jobs,settle()]).then(()=>Promise.all([pool.end(),publicSpacePools?.close(),editorialSpacePools?.close()])).then(()=>process.exit(0));});setTimeout(()=>process.exit(1),20000).unref();});
