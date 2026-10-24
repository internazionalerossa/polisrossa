import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {newNodeDraft} from '../app/lib/node-studio-model';
import {createPublicSpaceSeed} from '../app/platform/public-space-seed';
import {publicSpaceFeedResponse} from '../server/public-space-feed';
import type {SourceDefinition} from '../app/data/catalog';
import type {ArticleRecord,SourceFetchResult} from '../app/lib/feed';
import {NodeRassegna} from '../app/components/NodeRassegna';

const draft={...newNodeDraft('create-node','astronomia'),
 name:'Astronomia',topic:'Astronomia e osservazioni',description:'Una comunità per la ricerca astronomica.',
 sources:[
  {id:'osservatorio',name:'Osservatorio',homepage:'https://observatory.example/',feedUrl:'https://observatory.example/rss'},
  {id:'ricerca',name:'Ricerca',homepage:'https://research.example/',feedUrl:'https://research.example/rss'},
 ],blocks:[]};
const seed=createPublicSpaceSeed(draft);
const article=(source:SourceDefinition):ArticleRecord=>({
 id:source.id+'-article',sourceId:source.id,sourceName:source.name,sourceHomepage:source.homepage,
 region:source.region,country:source.country,language:source.language,kind:source.kind,
 feedSourceId:source.id,ideologies:[],title:'Una scoperta astronomica verificata',
 link:source.homepage+'report',publishedAt:'2026-10-24T09:00:00Z',author:null,
 excerpt:'Le osservazioni scientifiche sono state confrontate con le fonti originali.',
 categories:[],topics:[],image:null,score:0,
});
test('installed thematic feed uses only its own approved publisher sources and bounded requests',async()=>{
 const sources:string[]=[];
 const load=async(source:SourceDefinition,limit:number):Promise<SourceFetchResult>=>{
  sources.push(source.id);
  assert.equal(limit,15);
  return {source,articles:[article(source)],status:{
   sourceId:source.id,name:source.name,ok:true,count:1,feedUrl:source.feedUrls?.[0]??null,
   error:null,fetchedAt:'2026-10-24T09:00:00Z',cached:false,
  }};
 };
 const url='https://site.test/api/public-spaces/astronomia/feed';
 const res=await publicSpaceFeedResponse(new Request(url),seed,load);
 assert.equal(res.status,200);
 const data=await res.json();
 assert.deepEqual(sources,['astronomia:osservatorio','astronomia:ricerca']);
 assert.equal(data.spaceId,'astronomia');
 assert.equal(data.articles.length,2);
 assert.deepEqual(data.articles.map((a:{sourceId:string})=>a.sourceId),sources);
 assert.equal((await publicSpaceFeedResponse(new Request(url+'?sourceIds=ricerca'),seed,load)).status,200);
 assert.equal((await publicSpaceFeedResponse(new Request(url+'?sourceIds=non-autorizzato'),seed,load)).status,400);
 assert.equal((await publicSpaceFeedResponse(new Request(url+'?sourceIds=ricerca,ricerca'),seed,load)).status,400);
 assert.equal((await publicSpaceFeedResponse(new Request('https://site.test/api/public-spaces/polisrossa/feed'),seed,load)).status,400);
 assert.equal((await publicSpaceFeedResponse(new Request(url,{method:'POST'}),seed,load)).status,405);
});
test('the common article grid preserves PolisRossa classes and never injects thematic politics',()=>{
 const source:SourceDefinition={id:'astronomia:osservatorio',name:'Osservatorio',homepage:'https://observatory.example/',
 feedUrls:[],region:'Mondo',country:'Italia',language:'it',kind:'giornale',ideologies:[],tags:[],priority:0};
 const html=renderToStaticMarkup(createElement(NodeRassegna,{spaceId:'astronomia',articles:[article(source)]}));
 assert.match(html,/class="news-grid"/);
 assert.match(html,/class="article-card"/);
 assert.match(html,/class="article-open"/);
 assert.match(html,/Leggi e sostieni la fonte/);
 assert.match(html,/class="article-copy"/);
 assert.match(html,/class="article-meta"/);
 assert.match(html,/Una scoperta astronomica verificata/);
 assert.doesNotMatch(html,/PolisRossa|socialista|comunista/);
});
