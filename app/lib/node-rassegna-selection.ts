import type {ArticleRecord} from './feed';

export type RassegnaFilters={
 query:string;source:string;language:string;country:string;
 period:'day'|'week'|'month'|'all';
 sort:'recent'|'source';
};
const fold=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('it');
const published=(article:ArticleRecord)=> {
 const parsed=Date.parse(article.publishedAt??'');
 return Number.isFinite(parsed)?parsed:null;
};
/** Pure node-independent Rassegna selection used with PolisRossa's visual conventions. */
export function selectNodeRassegna(
 articles:readonly ArticleRecord[],filters:RassegnaFilters,now=Date.now(),
):ArticleRecord[]{
 const duration={day:86400000,week:604800000,month:2592000000,all:Infinity}[filters.period];
 const terms=fold(filters.query.trim()).split(/\s+/).filter(Boolean);
 return articles.filter(item=>{
  if(filters.source!=='all'&&item.sourceId!==filters.source)return false;
  if(filters.language!=='all'&&item.language!==filters.language)return false;
  if(filters.country!=='all'&&item.country!==filters.country)return false;
  const when=published(item);
  if(filters.period!=='all'&&(when===null||when>now+300000||now-when>duration))return false;
  const searchable=fold([item.title,item.excerpt,item.sourceName,...item.categories].join(' '));
  return terms.every(term=>searchable.includes(term));
 }).sort((a,b)=>{
  if(filters.sort==='source'){
   const c=a.sourceName.localeCompare(b.sourceName,'it');
   if(c)return c;
  }
  return (published(b)??-Infinity)-(published(a)??-Infinity)||a.id.localeCompare(b.id);
 });
}
