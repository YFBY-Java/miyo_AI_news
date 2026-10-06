import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_SIZE_LIMITS, getCardSize } from '../src/core/card-layout';
import { audioKey, blankProject, compileEpisode, estimatePlan, InputError, projectKey, validateProject } from '../src/core/project';
import type { Card, CardSize, Project } from '../src/core/types';

function projectWithSize(size:unknown):Project {
  const project=blankProject('手动尺寸回归');
  (project.scenes[0].cards[0] as Card & {size:unknown}).size=size as CardSize;
  return project;
}
function withinLimits(size:CardSize){
  assert.ok(Number.isInteger(size.width));assert.ok(Number.isInteger(size.height));
  assert.ok(size.width>=CARD_SIZE_LIMITS.width.min&&size.width<=CARD_SIZE_LIMITS.width.max);
  assert.ok(size.height>=CARD_SIZE_LIMITS.height.min&&size.height<=CARD_SIZE_LIMITS.height.max);
}

test('legacy cards without size remain optional through validation and compilation',()=>{
  const original=blankProject('旧项目兼容');
  const originalJson=JSON.stringify(original);
  const validated=validateProject(JSON.parse(originalJson));
  const episode=compileEpisode(validated,estimatePlan(validated));
  assert.equal(Object.hasOwn(validated.scenes[0].cards[0],'size'),false);
  assert.equal(Object.hasOwn(episode.scenes[0].cards[0],'size'),false);
  assert.equal(episode.scenes[0].cards[0].id,original.scenes[0].cards[0].id);
  assert.equal(JSON.stringify(original),originalJson);
  withinLimits(getCardSize(episode.scenes[0].cards[0],0));
});

test('manual dimensions and stable card ids survive saved JSON and compiled episode round trips',()=>{
  const original=projectWithSize({width:1600,height:560});
  const second={...structuredClone(original.scenes[0].cards[0]),id:'second-sized-card',size:{width:940,height:650}};
  original.scenes[0].cards.push(second);
  original.scenes[0].focus.push({at:.5,cardId:second.id,transition:'orbit'});
  const saved=validateProject(JSON.parse(JSON.stringify(validateProject(original))));
  const episode=JSON.parse(JSON.stringify(compileEpisode(saved,estimatePlan(saved))));
  assert.deepEqual(saved.scenes[0].cards.map(card=>({id:card.id,size:card.size})),
    original.scenes[0].cards.map(card=>({id:card.id,size:card.size})));
  assert.deepEqual(episode.scenes[0].cards.map((card:Card)=>({id:card.id,size:card.size})),
    original.scenes[0].cards.map(card=>({id:card.id,size:card.size})));
  assert.equal(episode.scenes[0].focusCues[1].cardIndex,1);
});

test('all inclusive width and height boundary combinations are accepted as integer pixels',()=>{
  assert.deepEqual(CARD_SIZE_LIMITS,{width:{min:800,max:1720},height:{min:360,max:660}});
  for(const width of [800,1720])for(const height of [360,660]){
    const project=validateProject(projectWithSize({width,height}));
    assert.deepEqual(project.scenes[0].cards[0].size,{width,height});
  }
});

test('out-of-range, fractional, non-finite, missing and nonnumeric dimensions are rejected',()=>{
  const invalid:unknown[]=[null,false,'1600x600',[],{},
    {width:799,height:500},{width:1721,height:500},{width:1000,height:359},{width:1000,height:661},
    {width:1000.5,height:500},{width:1000,height:500.5},
    {width:NaN,height:500},{width:1000,height:Infinity},{width:-Infinity,height:500},
    {width:'1000',height:500},{width:1000,height:'500'},{width:1000},{height:500}];
  invalid.forEach((size,index)=>assert.throws(()=>validateProject(projectWithSize(size)),
    (error:unknown)=>error instanceof InputError&&error.status===400,`invalid size case ${index}`));
});

test('unsized cards have varied index defaults while legacy cardScale only scales these defaults',()=>{
  const full=Array.from({length:6},(_,index)=>getCardSize({},index,1.2));
  assert.equal(new Set(full.map(size=>`${size.width}x${size.height}`)).size,6);
  for(let index=0;index<6;index++){
    const scaled=getCardSize({},index,1),small=getCardSize({},index,.7);
    withinLimits(full[index]);withinLimits(scaled);withinLimits(small);
    assert.equal(scaled.width,Math.round(full[index].width/1.2));
    assert.equal(scaled.height,Math.round(full[index].height/1.2));
    assert.ok(small.width<scaled.width&&small.height<=scaled.height);
  }
  assert.deepEqual(getCardSize({},6,1.2),full[0]);
  assert.deepEqual(getCardSize({},0,3),full[0]);
  assert.deepEqual(getCardSize({},0,NaN),full[0]);
});

test('explicit dimensions are final pixels at any global scale and resolving them cannot mutate the card',()=>{
  const card={size:{width:1650,height:650}};
  for(const scale of [.7,1,1.2])for(const index of [0,2,5]){
    const result=getCardSize(card,index,scale);assert.deepEqual(result,{width:1650,height:650});
    result.width=800;result.height=360;
    assert.deepEqual(card.size,{width:1650,height:650});
  }
});

test('changing or clearing a manual size changes visual cache identity without changing narration identity or timings',()=>{
  const original=blankProject('缓存回归');const baselineAudio=audioKey(original),baselineProject=projectKey(original);
  const baselineEpisode=compileEpisode(original,estimatePlan(original));
  const changed=structuredClone(original);changed.scenes[0].cards[0].size={width:1700,height:640};
  const checked=validateProject(changed);
  assert.equal(audioKey(checked),baselineAudio);assert.notEqual(projectKey(checked),baselineProject);
  const changedEpisode=compileEpisode(checked,estimatePlan(checked));
  assert.equal(changedEpisode.duration,baselineEpisode.duration);assert.deepEqual(changedEpisode.cues,baselineEpisode.cues);
  assert.deepEqual(changedEpisode.scenes[0].focusCues,baselineEpisode.scenes[0].focusCues);
  delete checked.scenes[0].cards[0].size;
  assert.equal(audioKey(checked),baselineAudio);assert.equal(projectKey(checked),baselineProject);
  assert.deepEqual(getCardSize(checked.scenes[0].cards[0],0),getCardSize(original.scenes[0].cards[0],0));
});
