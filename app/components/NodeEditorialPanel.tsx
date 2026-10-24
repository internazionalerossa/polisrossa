"use client";
import {useEffect,useState} from 'react';
import NodeStudio from './NodeStudio';
import type {NodeBlueprintDraft} from '../lib/node-studio-model';
import type {PublicSpaceSeed} from '../platform/public-space-seed';

type Published={digest:string|null;sequence:number;content:unknown};
type Proposal={id:string;content_digest:string;content_json:unknown;electorate_size:number;status:string;created_at:string};
type Board={spaceId:string;initialized:boolean;mode:string;members:number;head:Published|null;proposals:Proposal[]};
const endpoint=(id:string)=>'/api/node-editorial?'+new URLSearchParams({spaceId:id});

function ProposedContent({content}:{content:unknown}){
 const value=content&&typeof content==='object'&&!Array.isArray(content)?content as Record<string,unknown>:{};
 const sources=Array.isArray(value.sources)?value.sources:[];
 const blocks=Array.isArray(value.blocks)?value.blocks:[];
 return <div className="node-studio-preview-block">
  <h4>{typeof value.name==='string'?value.name:'Revisione del nodo'}</h4>
  {typeof value.topic==='string'?<p><strong>Tema:</strong> {value.topic}</p>:null}
  {typeof value.description==='string'?<p>{value.description}</p>:null}
  <p><strong>Fonti proposte:</strong> {sources.length}</p>
  <ul>{sources.slice(0,30).map((source,i)=>{
   const record=source&&typeof source==='object'?source as Record<string,unknown>:{};
   return <li key={i}>{String(record.name??'Fonte')} · {String(record.homepage??'')}</li>;
  })}</ul>
  <p><strong>Voci, libri, Timeline e dati:</strong> {blocks.length}</p>
  <ol>{blocks.slice(0,80).map((block,i)=>{
   const record=block&&typeof block==='object'?block as Record<string,unknown>:{};
   return <li key={i}><strong>{String(record.title??'Voce')}</strong>
    <p>{String(record.body??'')}</p></li>;
  })}</ol>
 </div>;
}

/** Node-specific PR2 membership and editorial proposals, never a role simulator. */
export default function NodeEditorialPanel({seed}:{seed:PublicSpaceSeed}){
 const [board,setBoard]=useState<Board|null>(null);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [loading,setLoading]=useState(true);
 const [revision,setRevision]=useState(0);
 const [busy,setBusy]=useState(false);
 const url=endpoint(seed.spaceId);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');
  void fetch(url,{signal:controller.signal,cache:'no-store',credentials:'same-origin'})
   .then(async response=>{
    if(!response.ok)throw Error('Servizio editoriale non disponibile su questo host');
    return response.json() as Promise<Board>;
   }).then(info=>{if(!controller.signal.aborted)setBoard(info);})
   .catch(e=>{if(!controller.signal.aborted){setBoard(null);setError(e instanceof Error?e.message:'Servizio offline');}})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[url,revision]);
 async function action(payload:Record<string,unknown>):Promise<Record<string,unknown>>{
  setBusy(true);setError('');setNotice('');
  try{
   const result=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
   const data=await result.json() as Record<string,unknown>;
   if(!result.ok)throw Error(typeof data.error==='string'?data.error:'Richiesta non autorizzata');
   setRevision(v=>v+1);
   return data;
  }catch(e){setError(e instanceof Error?e.message:'Operazione fallita');throw e;}
  finally{setBusy(false);}
 }
 async function propose(draft:NodeBlueprintDraft,expectedBaseDigest:string|null):Promise<string>{
  if(!board?.initialized)throw Error('Lo stato editoriale non è stato inizializzato.');
  const result=await action({action:'propose',draft,expectedBaseDigest});
  return result.status==='published'?'Revisione pubblicata: era presente un solo PR2 attivo.':
   'Proposta registrata per il voto dei PR2 di questo nodo. I contenuti pubblici non sono cambiati.';
 }
 return <section aria-labelledby="node-editorial-title" className="node-editorial-panel">
  <h2 id="node-editorial-title">Governance editoriale del nodo {seed.name}</h2>
  <p>La prima appartenenza PR2 verificata apre la gestione individuale. Con il secondo PR2 il nodo passa automaticamente alle revisioni collegiali con maggioranza e storico immutabile.</p>
  {loading?<p role="status">Verifica dello stato editoriale…</p>:null}
  {error?<p role="alert">{error}</p>:null}
  {notice?<p role="status">{notice}</p>:null}
  {board?<div>
   <p><strong>Modalità:</strong> {board.initialized?(board.mode==='collective'?'Collegiale':'Iniziale, un PR2'):'Da inizializzare'} · {board.members} PR2 iscritti.</p>
   {board.head?.sequence?<p>Ultima revisione pubblicata: {board.head.sequence} · {board.head.digest}</p>:null}
   <div className="node-studio-actions">
    {!board.initialized?<button type="button" disabled={busy} onClick={()=>void action({action:'found'}).then(()=>setNotice('Nodo inizializzato con una credenziale PR2 verificata.')).catch(()=>{})}>
     Inizia la gestione come primo PR2 verificato
    </button>:
     <button type="button" disabled={busy} onClick={()=>void action({action:'join'}).then(result=>setNotice(result.mode==='collective'?'Iscrizione verificata: diritto collegiale attivo.':'Iscrizione PR2 verificata.')).catch(()=>{})}>
      Conferma l'appartenenza PR2 a questo nodo
     </button>}
   </div>
   {board.initialized?<NodeStudio spaceId={seed.spaceId} seed={seed} baseDigest={board.head?.digest??null} onPropose={propose}/>:null}
   <section aria-labelledby="editorial-proposals-title">
    <h3 id="editorial-proposals-title">Revisioni sottoposte al voto</h3>
    {board.proposals.length===0?<p>Nessuna proposta editoriale aperta.</p>:null}
    {board.proposals.map(proposal=><article key={proposal.id} className="agora-forum-role">
     <p><strong>Digest della proposta:</strong> <code>{proposal.content_digest}</code></p>
     <p>Corpo elettorale congelato: {proposal.electorate_size} PR2.</p>
     <ProposedContent content={proposal.content_json}/>
     <div className="node-studio-actions">
      <button type="button" disabled={busy} onClick={()=>void action({action:'vote',proposalId:proposal.id,choice:'yes'})
       .then(data=>setNotice(data.status==='published'?'Revisione approvata e pubblicata.':'Voto favorevole registrato.')).catch(()=>{})}>Approva questa revisione</button>
      <button type="button" disabled={busy} onClick={()=>void action({action:'vote',proposalId:proposal.id,choice:'no'})
       .then(()=>setNotice('Voto contrario registrato.')).catch(()=>{})}>Vota contro</button>
     </div>
    </article>)}
   </section>
  </div>:!loading?<p>Per intervenire è necessario un servizio backend attivo e un database del nodo installato. L'anteprima statica non concede diritti.</p>:null}
 </section>;
}
