import type {NodeStudioBlock} from './node-studio-model';

export type EditorialBlockChange={
 id:string;kind:'added'|'removed'|'modified';
 previous:NodeStudioBlock|null;next:NodeStudioBlock|null;
};

/**
 * Human-reviewable changes at the level of one Atlas page/paragraph.
 * Stable UUID identity prevents a rewritten title being mistaken for a new page.
 * This is presentation only: PR2 ballots still bind to the full proposal digest.
 */
export function reviewEditorialChanges(
 previous:readonly NodeStudioBlock[],next:readonly NodeStudioBlock[],
):EditorialBlockChange[]{
 const before=new Map(previous.map(item=>[item.id,item]));
 const after=new Map(next.map(item=>[item.id,item]));
 if(before.size!==previous.length||after.size!==next.length)
  throw Error('Duplicated editorial block IDs');
 const changes:EditorialBlockChange[]=[];
 for(const item of previous){
  const updated=after.get(item.id);
  if(!updated){changes.push({id:item.id,kind:'removed',previous:item,next:null});continue;}
  if(item.title!==updated.title||item.body!==updated.body||item.url!==updated.url||item.kind!==updated.kind)
   changes.push({id:item.id,kind:'modified',previous:item,next:updated});
 }
 for(const item of next)
  if(!before.has(item.id))changes.push({id:item.id,kind:'added',previous:null,next:item});
 return changes;
}
