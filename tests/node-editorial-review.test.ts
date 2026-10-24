import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEditorialChanges} from '../app/lib/node-editorial-review';
import type {NodeStudioBlock} from '../app/lib/node-studio-model';

const entry=(id:string,title:string,body:string):NodeStudioBlock=>({id,kind:'atlas',title,body,url:''});
test('PR2 change review distinguishes paragraph edits, additions and removals by immutable block ID',()=>{
 const original=[entry('alpha','Astronomia','Testo vecchio'),entry('beta','Galileo','Vecchio capitolo')];
 const proposed=[entry('alpha','Astronomia','Testo revisionato'),entry('gamma','Keplero','Nuova voce')];
 assert.deepEqual(reviewEditorialChanges(original,proposed).map(change=>[change.id,change.kind]),
  [['alpha','modified'],['beta','removed'],['gamma','added']]);
 const before=reviewEditorialChanges(original,proposed)[0];
 assert.equal(before.previous?.body,'Testo vecchio');
 assert.equal(before.next?.body,'Testo revisionato');
 assert.equal(original[0].body,'Testo vecchio');
 assert.deepEqual(reviewEditorialChanges(original,original),[]);
 assert.throws(()=>reviewEditorialChanges([original[0],original[0]],proposed),/Duplicated editorial block IDs/);
});
