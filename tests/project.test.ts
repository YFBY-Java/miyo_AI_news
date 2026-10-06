import test from 'node:test';
import assert from 'node:assert/strict';
import { audioKey, blankProject, compileEpisode, estimatePlan, projectKey, toSrt, validateProject } from '../src/core/project';
import { publicUrl } from '../src/server/sources';

test('画面编辑不让配音失效，口播/语速/声线/顺序变化会失效',()=>{
  const original=blankProject();const visual=structuredClone(original);visual.game='genshin';visual.scenes[0].cards[0].body='新的画面详细说明';
  assert.equal(audioKey(original),audioKey(visual));assert.notEqual(projectKey(original),projectKey(visual));
  const spoken=structuredClone(original);spoken.scenes[0].narration+='这句需要重新合成。';assert.notEqual(audioKey(original),audioKey(spoken));
  const speed=structuredClone(original);speed.voice.speed=1.2;assert.notEqual(audioKey(original),audioKey(speed));
  const voice=structuredClone(original);voice.voice.preset='xiaoxiao';assert.notEqual(audioKey(original),audioKey(voice));
});
test('卡片按稳定ID绑定焦点，重排卡片仍指向原卡',()=>{
  const p=blankProject();const first=p.scenes[0].cards[0];const second={...first,id:'second',title:'第二张'};p.scenes[0].cards=[second,first];
  const episode=compileEpisode(validateProject(p),estimatePlan(p));assert.equal(episode.scenes[0].focusCues![0].cardIndex,1);
  p.scenes[0].cards=[second];assert.throws(()=>validateProject(p),/已删除/);
});
test('全局字幕与章节时码从单一音轨计划建立',()=>{
  const p=blankProject();p.scenes.push({...structuredClone(p.scenes[0]),id:'scene2'});
  const plan={duration:13,preset:p.voice.preset,speed:p.voice.speed,audioFile:'narration.wav',scenes:[{id:p.scenes[0].id,duration:6,cues:[{start:.5,end:4,text:'第一段。'}]},{id:'scene2',duration:7,cues:[{start:1,end:6,text:'第二段。'}]}]};
  const episode=compileEpisode(p,plan);assert.equal(episode.duration,13);assert.equal(episode.scenes[1].start,6);assert.equal(episode.cues[1].start,7);assert.match(toSrt(episode),/00:00:07,000 --> 00:00:12,000/);
  plan.scenes[1].cues[0].end=10;assert.throws(()=>compileEpisode(p,plan),/字幕时码/);
});
test('拒绝失序焦点、不支持的声线、路径ID和脚本链接',()=>{
  const p=blankProject();p.scenes[0].focus.push({...p.scenes[0].focus[0],at:0});assert.throws(()=>validateProject(p),/递增/);
  const bad=blankProject();bad.id='../escape';assert.throws(()=>validateProject(bad),/无效/);
  const voice=blankProject();(voice.voice as any).preset='unknown';assert.throws(()=>validateProject(voice),/声线/);
});
test('公开资料读取拒绝内网、localhost和非HTTP协议',async()=>{
  for(const url of ['http://127.0.0.1:3002/api/projects','http://localhost','http://10.0.0.1','http://[::1]','file:///etc/passwd','https://user:password@example.com'])await assert.rejects(publicUrl(url));
});
