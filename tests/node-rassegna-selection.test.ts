import test from 'node:test';
import assert from 'node:assert/strict';
import {selectNodeRassegna,type RassegnaFilters} from '../app/lib/node-rassegna-selection';
import type {ArticleRecord} from '../app/lib/feed';

const base:ArticleRecord={id:'first',sourceId:'node:one',sourceName:'Fonte Uno',sourceHomepage:'https://example.org',
 region:'Europa',country:'Italia',language:'it',kind:'giornale',ideologies:[],
 title:'Ricerca scientifica',link:'https://example.org/article',publishedAt:'2026-10-24T11:00:00.000Z',
 author:null,excerpt:'Studio verificabile',categories:['scienza'],topics:[],image:null,score:0};
const filters:RassegnaFilters={query:'',source:'all',language:'all',country:'all',period:'all',sort:'recent'};
const now=Date.parse('2026-10-24T12:00:00Z');

test('node Rassegna filters language, country, source, period and accent-insensitive terms',()=>{
 const older={...base,id:'older',sourceId:'node:two',sourceName:'Source Two',country:'Francia',language:'fr',
  title:'Astronomie',publishedAt:'2026-10-15T12:00:00.000Z'};
 const items=[older,base];
 assert.deepEqual(selectNodeRassegna(items,{...filters,query:'RICERCA'},now).map(a=>a.id),['first']);
 assert.deepEqual(selectNodeRassegna(items,{...filters,language:'fr'},now).map(a=>a.id),['older']);
 assert.deepEqual(selectNodeRassegna(items,{...filters,country:'Italia'},now).map(a=>a.id),['first']);
 assert.deepEqual(selectNodeRassegna(items,{...filters,source:'node:two'},now).map(a=>a.id),['older']);
 assert.deepEqual(selectNodeRassegna(items,{...filters,period:'week'},now).map(a=>a.id),['first']);
 assert.deepEqual(selectNodeRassegna(items,{...filters,sort:'recent'},now).map(a=>a.id),['first','older']);
 assert.equal(selectNodeRassegna([{...older,publishedAt:null}],{...filters,period:'day'},now).length,0);
});
