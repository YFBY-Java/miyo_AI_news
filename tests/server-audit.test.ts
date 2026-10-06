import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { audioKey, blankProject, compileEpisode, validateProject } from '../src/core/project';

let temporary:string;
let handleApi:(request:Request)=>Promise<Response>;
const previousData=process.env.MOYO_DATA_DIR;
before(async()=>{
  temporary=await fs.mkdtemp(path.join(os.tmpdir(),'moyo-server-audit-'));
  process.env.MOYO_DATA_DIR=path.join(temporary,'data');
  await fs.mkdir(process.env.MOYO_DATA_DIR);
  await fs.writeFile(path.join(process.env.MOYO_DATA_DIR,'initialized.json'),'{}');
  await fs.writeFile(path.join(process.env.MOYO_DATA_DIR,'audio.wav'),'0123456789');
  await fs.writeFile(path.join(process.env.MOYO_DATA_DIR,'empty.log'),'');
  await fs.writeFile(path.join(temporary,'outside.txt'),'outside');
  await fs.symlink(path.join(temporary,'outside.txt'),path.join(process.env.MOYO_DATA_DIR,'escape.txt'));
  ({handleApi}=await import('../src/server/http'));
});
after(async()=>{
  await fs.rm(temporary,{recursive:true,force:true});
  if(previousData===undefined)delete process.env.MOYO_DATA_DIR;else process.env.MOYO_DATA_DIR=previousData;
});
const asset=(name:string,range?:string)=>handleApi(new Request('http://localhost/api/media/'+name,{headers:range?{range}:{}}));

test('media ranges return exact content and reject invalid ranges',async()=>{
  const response=await asset('audio.wav','bytes=2-4');
  assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 2-4/10');assert.equal(await response.text(),'234');
  const suffix=await asset('audio.wav','bytes=-3');assert.equal(await suffix.text(),'789');
  const invalid=await asset('audio.wav','bytes=10-');assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),'bytes */10');
});
test('media missing file returns JSON 404 instead of a rejected promise',async()=>{
  const response=await asset('missing.wav');assert.equal(response.status,404);assert.equal((await response.json()).error,'文件不存在');
});
test('media realpath containment rejects a symlink outside data',async()=>{
  const response=await asset('escape.txt');assert.equal(response.status,403);assert.equal((await response.json()).error,'不可访问此文件');
});
test('empty media logs can be read without a negative stream range',async()=>{
  const response=await asset('empty.log');assert.equal(response.status,200);assert.equal(await response.text(),'');assert.equal(response.headers.get('content-length'),'0');
});
test('project validation preserves provided source and narration verbatim',()=>{
  const project=blankProject();
  const original='  原文：a < b，保留英文 AI、数字 1.2、换行。\n\n另一段：不改写。  ';
  project.sources=[{id:'source-1',title:'原文',url:'',publisher:'',date:'',note:'',text:original,status:'unverified'}];
  project.scenes[0].narration=original;
  const checked=validateProject(project);assert.equal(checked.sources[0].text,original);assert.equal(checked.scenes[0].narration,original);
});
test('visual changes reuse audio key while narration and voice changes invalidate it',()=>{
  const original=blankProject();const key=audioKey(original);const visual=structuredClone(original);
  visual.game='genshin';visual.scenes[0].cards[0].body='修改画面正文';visual.presentation.particles=2;
  assert.equal(audioKey(visual),key);
  const speed=structuredClone(original);speed.voice.speed=1.2;assert.notEqual(audioKey(speed),key);
  const narration=structuredClone(original);narration.scenes[0].narration+='新增句子。';assert.notEqual(audioKey(narration),key);
});
test('VoicePlan local cues compile into continuous global scene timestamps',()=>{
  const project=blankProject();const second=structuredClone(project.scenes[0]);second.id='second';project.scenes.push(second);
  const plan={preset:project.voice.preset,speed:1.1,audioFile:'narration.wav',duration:17,
    scenes:[{id:project.scenes[0].id,duration:10,cues:[{start:.5,end:9.5,text:'第一场。'}]},
      {id:'second',duration:7,cues:[{start:.5,end:6.5,text:'第二场。'}]}]};
  const episode=compileEpisode(project,plan);assert.equal(episode.duration,17);assert.equal(episode.scenes[1].start,10);
  assert.deepEqual(episode.cues[1],{start:10.5,end:16.5,text:'第二场。'});
});
