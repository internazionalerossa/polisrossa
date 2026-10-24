"use client";
import {useEffect,useState} from 'react';
import {newNodeDraft,nodeStudioDraft,blueprintToProposal,type NodeBlueprintDraft} from '../lib/node-studio-model';
import {timelineProposalLink} from '../lib/timeline-proposal';
import {StudioBlocks,StudioSources} from './NodeStudioFields';
import {NODE_PRIMARY_TABS} from '../lib/node-primary-navigation';
import {editStudioBlock,appendAtlasEntry} from '../lib/node-studio-editor';
import type {PublicSpaceSeed} from '../platform/public-space-seed';

type Props={spaceId:string;seed?:PublicSpaceSeed;onPropose?:(draft:NodeBlueprintDraft,baseDigest:string|null)=>Promise<string>;baseDigest?:string|null;onCreateNode?:(draft:NodeBlueprintDraft)=>Promise<string>};
const key=(spaceId:string)=>'agoranode.node-studio.draft.v1:'+spaceId;
const baseKey=(spaceId:string)=>'agoranode.node-studio.edited-base.v1:'+spaceId;
export default function NodeStudio({spaceId,seed,onPropose,onCreateNode,baseDigest}:Props){
 const [draft,setDraft]=useState<NodeBlueprintDraft>(()=>newNodeDraft(spaceId==='agora'?'create-node':'edit-node',spaceId==='agora'?'nuovo-nodo':spaceId));
 const [saved,setSaved]=useState<NodeBlueprintDraft[]>([]);
 const [account,setAccount]=useState(false);
 const [status,setStatus]=useState('');
 const [preview,setPreview]=useState(false);
 const [previewTab,setPreviewTab]=useState<'notizie'|'teoria'|'partecipa'>('notizie');
 const [busy,setBusy]=useState(false);
 const [editedBase,setEditedBase]=useState<string|null|undefined>(baseDigest);
 useEffect(()=>{
   let active=true;
   try{
     const raw=localStorage.getItem(key(spaceId));
     if(raw){
       setDraft(nodeStudioDraft(JSON.parse(raw)));
       const stored=localStorage.getItem(baseKey(spaceId));
       setEditedBase(stored==='null'?null:stored&&/^sha256:[0-9a-f]{64}$/.test(stored)?stored:undefined);
     }else if(seed){
       setDraft({...newNodeDraft('edit-node',spaceId),name:seed.name,topic:seed.topic,description:seed.description,accent:seed.accent,sources:seed.sources,blocks:seed.blocks});
       setEditedBase(baseDigest);
     }
   }catch{}
   const controller=new AbortController();
   void fetch('/api/node-studio/drafts',{signal:controller.signal,cache:'no-store',credentials:'same-origin'})
     .then(async response=>{
       if(response.status===401)return null;
       if(!response.ok)throw Error('Private drafts unavailable');
       return response.json() as Promise<{drafts:NodeBlueprintDraft[]}>;
     }).then(result=>{
       if(!active||!result)return;
       setAccount(true);
       setSaved(result.drafts.map(item=>nodeStudioDraft(item)));
     }).catch(()=>{});
   return()=>{active=false;controller.abort();};
 },[spaceId,seed,baseDigest]);
 const update=(patch:Partial<NodeBlueprintDraft>)=>setDraft(old=>({...old,...patch,updatedAt:Date.now()}));
 const updateBlock=(id:string,patch:{title:string}|{body:string})=>
  setDraft(previous=>editStudioBlock(previous,id,patch));
 const addAtlasEntry=()=>{
  if(draft.blocks.length>=80){setStatus('Il limite di 80 blocchi per bozza è stato raggiunto.');return;}
  setDraft(previous=>appendAtlasEntry(previous,crypto.randomUUID()));
  setPreviewTab('teoria');setPreview(true);
  setStatus('Voce dell’Atlante aggiunta alla bozza. Modifica titolo e testo direttamente nell’anteprima; non è pubblicata.');
 };
 const reset=(operation:'create-node'|'edit-node')=>{
   const next=newNodeDraft(operation,operation==='edit-node'?spaceId:'nuovo-nodo');
   if(operation==='edit-node')setEditedBase(baseDigest);
   setDraft(operation==='edit-node'?{...next,name:seed?.name??(spaceId==='agora'?'Agorà':spaceId==='polisrossa'?'PolisRossa':'Nodo tematico'),topic:seed?.topic??next.topic,description:seed?.description??next.description,accent:seed?.accent??next.accent,sources:seed?.sources??[],blocks:seed?.blocks??[]}:{...next,name:'',topic:'',description:'',sources:[],blocks:[]});
   setStatus('Nuova bozza avviata; non è stata pubblicata.');
 };
 /** A blueprint of the complete PolisRossa interface, never a clone of its content. */
 const fromReference=()=>{
   const next=newNodeDraft('create-node','nuovo-nodo');
   setDraft({...next,name:'Nuovo nodo',topic:'Argomento da approfondire',
     description:'Una comunità tematica con rassegna, Biblioteca, dati e spazio di partecipazione.',
     sources:[],blocks:[]});
   setPreviewTab('notizie');setPreview(true);
   setStatus('Formato PolisRossa caricato: navigazione, Biblioteca, moduli e comandi sono predisposti nell’anteprima. Fonti, testi e identità devono essere creati per il nuovo nodo. Nessun contenuto di PolisRossa è stato copiato.');
 };
 const save=async()=>{
   let checked:NodeBlueprintDraft;
   try{checked=nodeStudioDraft(draft);}
   catch(error){setStatus(error instanceof Error?error.message:'Controlla la bozza');return;}
   setBusy(true);
   try{
     localStorage.setItem(key(spaceId),JSON.stringify(checked));
     if(checked.operation==='edit-node'&&editedBase!==undefined)
       localStorage.setItem(baseKey(spaceId),editedBase??'null');
     if(account){
       const response=await fetch('/api/node-studio/drafts',{
         method:'PUT',credentials:'same-origin',headers:{'content-type':'application/json'},
         body:JSON.stringify({draft:checked}),
       });
       if(!response.ok)throw Error('Remote storage unavailable');
       const body=await response.json() as {draft:NodeBlueprintDraft};
       setSaved(old=>[body.draft,...old.filter(item=>item.draftId!==checked.draftId)].slice(0,20));
       setStatus('Bozza privata salvata nel tuo account.');
     }else setStatus('Bozza salvata sul dispositivo. Accedi come PR1 per salvarla nel tuo account.');
   }catch{setStatus('La bozza resta sul dispositivo. Il salvataggio nell’account non è riuscito.');}
   finally{setBusy(false);}
 };
 const propose=async()=>{
   if(!onPropose)return;
   let prepared:NodeBlueprintDraft;
   try{
     prepared=nodeStudioDraft(draft);
     if(prepared.operation!=='edit-node'||prepared.spaceId!==spaceId)throw Error('Seleziona Modifica il nodo per proporre una revisione di questa comunità.');
   }catch(e){setStatus(e instanceof Error?e.message:'Bozza non valida');return;}
   setBusy(true);
   if(editedBase===undefined){setStatus('La base di questa bozza non è verificabile: scegli Modifica il nodo e riparti dalla revisione pubblicata prima di proporre.');return;}
   try{setStatus(await onPropose(prepared,editedBase));}
   catch(e){setStatus(e instanceof Error?e.message:'Proposta non registrata');}
   finally{setBusy(false);}
 };
 const submitFounding=async()=>{
  if(!onCreateNode||spaceId!=='agora')return;
  let prepared:NodeBlueprintDraft;
  try{
   prepared=nodeStudioDraft(draft);
   if(prepared.operation!=='create-node')throw Error('Per fondare un nuovo nodo scegli la modalità Nuovo nodo.');
  }catch(e){setStatus(e instanceof Error?e.message:'Bozza non valida');return;}
  setBusy(true);
  try{setStatus(await onCreateNode(prepared));}
  catch(e){setStatus(e instanceof Error?e.message:'Proposta non registrata');}
  finally{setBusy(false);}
 };
 const download=()=>{
   let content:NodeBlueprintDraft;
   try{content=nodeStudioDraft(draft);}catch{setStatus('Completa e correggi i campi prima di esportare.');return;}
   const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download='bozza-agoranode-'+content.spaceId+'.json';a.click();
   setTimeout(()=>URL.revokeObjectURL(url),1500);
 };
 let proposal:string|null=null;
 if(spaceId==='polisrossa'){
   try{proposal=timelineProposalLink(blueprintToProposal(draft));}catch{}
 }
 return <section className="node-studio" id={'studio-'+spaceId} aria-labelledby={'studio-title-'+spaceId}>
   <header><p className="eyebrow">LABORATORIO · EDITOR VISUALE</p>
     <h2 id={'studio-title-'+spaceId}>Dai forma a un nodo, un blocco alla volta</h2>
     <p>Imposta argomento, fonti, pagine, timeline narrativa e biblioteca. Vedi l’anteprima e salva senza Git o codici.</p>
     <p>Un salvataggio è una <strong>bozza privata</strong>. Per rendere consultabile un nuovo nodo è disponibile il bootstrap pubblico read-only, installato manualmente da un operatore dopo la revisione di fonti e diritti. Non abilita account o voto PR2.</p>
     <p><a href="https://github.com/internazionalerossa/agoranode/blob/main/docs/THEMATIC-BOOTSTRAP.md" target="_blank" rel="noopener noreferrer">Come installare il nodo senza pubblicare bozze private ↗</a></p>
   </header>
   {spaceId==='agora'?<p className="node-studio-empty-invitation">In Agorà puoi proporre nuovi nodi tematici partendo dalla struttura comune di rassegna, Biblioteca, Atlante e partecipazione. Il modello funzionale deriva dall’esperienza dei nodi esistenti, senza copiarne contenuti o identità.</p>:<p className="node-studio-empty-invitation">Qui puoi proporre modifiche visive alle sezioni, alle Voci dell’Atlante, alla Timeline, alle fonti e alla bibliografia di questo nodo. La creazione di altri nodi è riservata ad Agorà.</p>}
   <div className="node-studio-modes" role="group" aria-label="Tipo di lavoro">
     {spaceId==='agora'?<><button type="button" onClick={fromReference}>Crea nuovo nodo · formato comune</button>
     <button type="button" onClick={()=>reset('create-node')}>Nuovo nodo · pagina vuota</button></>:null}
     <button type="button" aria-pressed={draft.operation==='edit-node'} onClick={()=>reset('edit-node')}>Modifica il nodo</button>
   </div>
   {account&&saved.length>0?<label>Bozze nel tuo account
     <select value="" onChange={e=>{const found=saved.find(item=>item.draftId===e.target.value);if(found){setDraft(found);setStatus('Bozza caricata.');}}}>
       <option value="">Scegli una bozza...</option>
       {saved.map(item=><option key={item.draftId} value={item.draftId}>{item.name} · {item.spaceId}</option>)}
     </select>
   </label>:null}
   <div className="node-studio-layout">
     <div className="node-studio-editor">
       <fieldset className="node-studio-group"><legend>01 · Identità della comunità</legend>
         <label>Identificatore <input autoComplete="off" maxLength={48} disabled={draft.operation==='edit-node'} value={draft.spaceId}
           onChange={e=>update({spaceId:e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'')})}/></label>
         <label>Nome del nodo <input autoComplete="off" maxLength={90} value={draft.name} onChange={e=>update({name:e.target.value})}/></label>
         <label>Argomento <input autoComplete="off" maxLength={180} value={draft.topic} onChange={e=>update({topic:e.target.value})}/></label>
         <label>Presentazione <textarea rows={3} maxLength={1500} value={draft.description} onChange={e=>update({description:e.target.value})}/></label>
         <label>Colore distintivo <input autoComplete="off" type="color" value={draft.accent} onChange={e=>update({accent:e.target.value})}/></label>
       </fieldset>
       <StudioSources draft={draft} update={update}/>
       <StudioBlocks draft={draft} update={update}/>
       <div className="node-studio-actions">
         <button type="button" disabled={busy} onClick={()=>void save()}>{busy?'Salvataggio…':'Salva bozza'}</button>
         <button type="button" aria-pressed={preview} onClick={()=>setPreview(value=>!value)}>{preview?'Nascondi anteprima':'Mostra anteprima'}</button>
         <button type="button" onClick={download}>Esporta bozza</button>
         {onPropose?<button type="button" disabled={busy} onClick={()=>void propose()}>Invia revisione editoriale</button>:null}
         {spaceId==='agora'&&onCreateNode?<button type="button" disabled={busy} onClick={()=>void submitFounding()}>Proponi il nuovo nodo ai PR3 di Agorà</button>:null}
       </div>
       {status?<p role="status">{status}</p>:null}
       {proposal?<a className="button button-outline" href={proposal}>Porta questa proposta al forum PR2 →</a>:
         <p role="status">La creazione pubblica di nodi tramite PR2/PR3 e il forum del nodo Agorà non sono ancora attivi. Esporta la bozza per una revisione senza pubblicarla automaticamente.</p>}
     </div>
     {preview?<aside className="node-studio-preview" aria-label="Anteprima privata">
       <p className="eyebrow">ANTEPRIMA · NON PUBBLICATA</p>
       <div style={{borderTop:'5px solid '+draft.accent,paddingTop:12}}>
         <h3>{draft.name}</h3><p>{draft.topic}</p><p>{draft.description}</p>
         <nav aria-label="Anteprima della navigazione del nodo">
           {NODE_PRIMARY_TABS.map(tab=><button type="button" key={tab.id} aria-pressed={previewTab===tab.id}
             onClick={()=>setPreviewTab(tab.id)}>{tab.label}</button>)}
         </nav>
         {previewTab==='notizie'?<section aria-label="Formato rassegna e video">
           <h4>Rassegna e video</h4><p>Controlli previsti: Tutti i feed · Feed preferiti · Ricerca · Filtri per fonte, lingua e tema · Video. Le fonti del nuovo nodo saranno configurate separatamente.</p>
           <p>{draft.sources.length} fonti proposte · Nessuna notizia importata da altri nodi.</p>
         </section>:previewTab==='teoria'?<section aria-label="Formato Biblioteca">
           <h4>Biblioteca</h4>
           <p>Libri e percorsi · Timeline e Atlante (Timeline / Indice e ricerca) · Dati e grafici.</p>
           <p>Le opere, le voci e i dati saranno quelli autorizzati del nuovo nodo, non copie dei cataloghi di altri nodi.</p>
         </section>:<section aria-label="Formato partecipazione">
           <h4>Agorà · Forum e proposte</h4>
           <p>Anteprima dei pulsanti e delle sezioni: Discussioni · Proposte · Partecipazione. Account, chat e voto restano disabilitati fino all’installazione del backend e alla verifica delle autorizzazioni proprie del nodo.</p>
         </section>}
         {draft.blocks.map(block=><article className="node-studio-preview-block" key={block.id} id={'studio-block-'+block.id}>
           <small>{block.kind}</small>
           <label>Titolo della voce o sezione
            <input value={block.title} maxLength={160} onChange={event=>updateBlock(block.id,{title:event.target.value})}/>
           </label>
           <label>{block.kind==='timeline'?'Racconto della tappa nella Timeline':'Testo del paragrafo o della voce'}
            <textarea rows={5} value={block.body} maxLength={4000}
             onChange={event=>updateBlock(block.id,{body:event.target.value})}/>
           </label>
           {block.url?<small>Fonte: {block.url}</small>:null}
           <button type="button" onClick={()=>update({blocks:draft.blocks.filter(item=>item.id!==block.id)})}
            aria-label={'Rimuovi dalla bozza: '+block.title}>Rimuovi blocco</button>
         </article>)}
         <div className="node-studio-actions">
          <button type="button" disabled={draft.blocks.length>=80} onClick={addAtlasEntry}>+ Nuova voce dell’Atlante</button>
         </div>
         <p>{draft.sources.length} fonti proposte · {draft.blocks.length} blocchi</p>
       </div>
     </aside>:null}
   </div>
 </section>;
}
