"use client";

import {useMemo,useState} from 'react';
import {ArrowDown,ArrowUpRight,Bookmark,BookmarkCheck,Search,X} from 'lucide-react';
import type {ArticleRecord} from '../lib/feed';
import {selectNodeRassegna} from '../lib/node-rassegna-selection';

/**
 * Shared Rassegna presentation: the article-card, news-grid and filter controls
 * preserve the established PolisRossa visual conventions. Content is supplied
 * exclusively by the node's own source registry/API, never by PolisRossa.
 */
type Props={spaceId:string;articles:readonly ArticleRecord[];emptyText?:string;title?:string; savedIds?:ReadonlySet<string>; onToggleSave?:(article:ArticleRecord)=>void};
const safeHref=(raw:string):string|null=>{
 try{const url=new URL(raw);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}
 catch{return null;}
};
export function NodeRassegna({spaceId,articles,emptyText='Nessun articolo disponibile dalle fonti di questo nodo.',title='Rassegna stampa',savedIds,onToggleSave}:Props){
 const [query,setQuery]=useState('');
 const [source,setSource]=useState('all');
 const [sort,setSort]=useState<'recent'|'source'>('recent');
 const [language,setLanguage]=useState('all');
 const [country,setCountry]=useState('all');
 const [period,setPeriod]=useState<'day'|'week'|'month'|'all'>('all');
 const [visible,setVisible]=useState(24);
 const sources=useMemo(()=>[...new Map(articles.map(article=>[article.sourceId,article.sourceName])).entries()]
  .sort((a,b)=>a[1].localeCompare(b[1],'it')),[articles]);
 const languages=useMemo(()=>[...new Set(articles.map(x=>x.language).filter(Boolean))].sort(),[articles]);
 const countries=useMemo(()=>[...new Set(articles.map(x=>x.country).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it')),[articles]);
 const filtered=useMemo(()=>selectNodeRassegna(articles,{
  query,source,language,country,period,sort,
 }),[articles,query,source,language,country,period,sort]);
 const reset=()=>{setQuery('');setSource('all');setLanguage('all');setCountry('all');setPeriod('all');setSort('recent');setVisible(24);};
 return <section className="node-rassegna" data-space-id={spaceId} aria-labelledby={'node-rassegna-title-'+spaceId}>
  <header className="news-heading"><p className="eyebrow">STAMPA · FONTI DEL NODO</p>
   <h2 id={'node-rassegna-title-'+spaceId}>{title}</h2></header>
  <div className="news-filters" aria-label="Filtri della rassegna">
   <label><Search size={16} aria-hidden="true"/> Cerca negli articoli
    <input type="search" maxLength={160} value={query} onChange={event=>{setQuery(event.target.value);setVisible(24);}}
     placeholder="Titolo, fonte, testo…" /></label>
   <label>Fonte
    <select value={source} onChange={event=>{setSource(event.target.value);setVisible(24);}}>
     <option value="all">Tutte le fonti</option>
     {sources.map(([id,name])=><option key={id} value={id}>{name}</option>)}
    </select></label>
   <label>Lingua della fonte
    <select value={language} onChange={event=>{setLanguage(event.target.value);setVisible(24);}}>
     <option value="all">Tutte le lingue</option>
     {languages.map(value=><option key={value} value={value}>{value}</option>)}
    </select></label>
   <label>Paese della testata
    <select value={country} onChange={event=>{setCountry(event.target.value);setVisible(24);}}>
     <option value="all">Tutti i paesi</option>
     {countries.map(value=><option key={value} value={value}>{value}</option>)}
    </select></label>
   <label>Periodo di pubblicazione
    <select value={period} onChange={event=>{setPeriod(event.target.value as 'day'|'week'|'month'|'all');setVisible(24);}}>
     <option value="day">Ultime 24 ore</option>
     <option value="week">Ultimi 7 giorni</option>
     <option value="month">Ultimi 30 giorni</option>
     <option value="all">Tutto il ricevuto</option>
    </select></label>
   <label>Ordine
    <select value={sort} onChange={event=>setSort(event.target.value as 'recent'|'source')}>
     <option value="recent">Più recenti prima</option><option value="source">Per testata</option>
    </select></label>
   <button type="button" className="text-link" onClick={reset}><X size={14}/> Azzera filtri</button>
  </div>
  <div className="news-selection-status" role="status"><strong>{filtered.length} articoli trovati</strong>
   <span> · {sort==='recent'?'Più recenti prima':'Per testata'}</span></div>
  <div className="news-layout"><div className="news-main">
   <div className="news-grid" aria-label="Articoli">{filtered.slice(0,visible).map(article=>{
    const href=safeHref(article.link),published=article.publishedAt&&Date.parse(article.publishedAt);
    return <article className="article-card" key={article.sourceId+'-'+article.id}>
     <div className="article-image">
      {article.image&&safeHref(article.image)?<img src={safeHref(article.image)!} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" width={640} height={360}/>:
       <span className="image-unavailable" aria-hidden="true"/>}
     </div>
     <div className="article-copy">
      <div className="article-meta"><span>{article.sourceName}</span>
       {published&&Number.isFinite(published)?<time dateTime={article.publishedAt!}>{new Intl.DateTimeFormat('it-IT',{dateStyle:'medium',timeStyle:'short'}).format(published)}</time>:null}
      </div>
      <h3>{href?<a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{article.title}</a>:article.title}</h3>
      <p>{article.excerpt||'Questo feed non fornisce un estratto. Apri la fonte originale per leggere l’articolo.'}</p>
     </div>
     <div className="article-bottom"><span>Fonte: {article.country||'Paese non verificato'} · {article.language}</span>
      <div>
       {href?<a className="publisher-link" href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Leggi dalla fonte <ArrowUpRight size={14}/></a>:null}
       {onToggleSave?<button type="button" className={`save-button ${savedIds?.has(article.id)?'is-saved':''}`}
        aria-label={savedIds?.has(article.id)?'Rimuovi dai salvati: '+article.title:'Salva articolo: '+article.title}
        aria-pressed={Boolean(savedIds?.has(article.id))} onClick={()=>onToggleSave(article)}>
         {savedIds?.has(article.id)?<BookmarkCheck size={17}/>:<Bookmark size={17}/>}
       </button>:null}
      </div>
     </div>
    </article>;
   })}</div>
   {filtered.length===0?<p role="status" className="node-feed-empty">{emptyText}</p>:null}
   {filtered.length>visible?<button type="button" className="button button-outline load-more" onClick={()=>setVisible(v=>v+24)}>
    Continua la lettura <ArrowDown size={16}/></button>:null}
  </div></div>
 </section>;
}
