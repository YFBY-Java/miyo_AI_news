import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { audioKey, blankProject, projectKey, validateProject } from '../src/core/project';
import type { Project, VoicePlan } from '../src/core/types';
import type { StoredJob } from '../src/server/storage';

let directory:string;
let storage:typeof import('../src/server/storage');
let referenceA:string;
let referenceB:string;
const envNames=['MOYO_DATA_DIR','MOYO_KIANA_VOICE_DIR','MOYO_KIANA_MODEL','MOYO_KIANA_REFERENCE',
  'MOYO_KIANA_REFERENCE_TEXT','MOYO_KIANA_PRESETS','MOYO_MLX_PYTHON'];
const originalEnv=Object.fromEntries(envNames.map(name=>[name,process.env[name]]));

function wavFixture(value=0):Buffer {
  const pcmBytes=48000*2, output=Buffer.alloc(44+pcmBytes);
  output.write('RIFF',0);output.writeUInt32LE(36+pcmBytes,4);output.write('WAVEfmt ',8);
  output.writeUInt32LE(16,16);output.writeUInt16LE(1,20);output.writeUInt16LE(1,22);
  output.writeUInt32LE(48000,24);output.writeUInt32LE(96000,28);output.writeUInt16LE(2,32);
  output.writeUInt16LE(16,34);output.write('data',36);output.writeUInt32LE(pcmBytes,40);
  output.writeInt16LE(value,44);return output;
}

before(async()=>{
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'moyo-storage-test-'));
  const voice=path.join(directory,'voice'),model=path.join(directory,'model');
  await fs.mkdir(voice);await fs.mkdir(model);
  referenceA=path.join(voice,'reference-a.wav');referenceB=path.join(voice,'reference-b.wav');
  await fs.writeFile(referenceA,wavFixture(1));await fs.writeFile(referenceB,wavFixture(2));
  await fs.writeFile(path.join(voice,'reference.txt'),'保持原始参考文本。');
  await fs.writeFile(path.join(voice,'presets.json'),'{"variants":[]}');
  await fs.writeFile(path.join(model,'config.json'),'{"testFixture":true}');
  process.env.MOYO_DATA_DIR=path.join(directory,'data');
  process.env.MOYO_KIANA_VOICE_DIR=voice;
  process.env.MOYO_KIANA_MODEL=model;
  process.env.MOYO_KIANA_REFERENCE=referenceA;
  process.env.MOYO_KIANA_REFERENCE_TEXT=path.join(voice,'reference.txt');
  process.env.MOYO_KIANA_PRESETS=path.join(voice,'presets.json');
  process.env.MOYO_MLX_PYTHON=path.join(directory,'not-an-inference-executable');
  storage=await import('../src/server/storage');
  for(const name of ['projects','jobs','runs'])await fs.mkdir(path.join(storage.DATA,name),{recursive:true});
});
after(async()=>{
  await fs.rm(directory,{recursive:true,force:true});
  for(const name of envNames){const value=originalEnv[name];if(value===undefined)delete process.env[name];else process.env[name]=value;}
});

async function savedProject():Promise<Project>{
  const project=validateProject(blankProject('隔离存储测试'));
  await storage.atomicJson(storage.projectPath(project.id),project);return project;
}
async function preparedFixture(project:Project){
  const id='prepared-'+project.id, dir=storage.runPath(id);
  await fs.mkdir(dir,{recursive:true});
  const audio=path.join(dir,'narration.wav');await fs.writeFile(audio,wavFixture());
  const voiceIdentity=await storage.voiceIdentity(project.voice.preset);
  const plan:VoicePlan={preset:project.voice.preset,speed:project.voice.speed,audioFile:'narration.wav',duration:1,
    scenes:[{id:project.scenes[0].id,duration:1,cues:[{start:.1,end:.9,text:project.scenes[0].narration}]}]};
  const job:StoredJob={id,projectId:project.id,revision:project.revision,kind:'prepare',status:'succeeded',
    stage:'complete',progress:100,message:'isolated fixture',createdAt:project.createdAt,updatedAt:project.updatedAt,
    audioKey:audioKey(project),projectKey:projectKey(project),voiceIdentity};
  await storage.atomicJson(path.join(dir,'voice-plan.json'),plan);
  await storage.atomicJson(path.join(dir,'audio-ready.json'),{audioKey:job.audioKey,voiceIdentity,sha256:await storage.fileHash(audio)});
  await storage.atomicJson(storage.jobPath(id),job);
  return {id,dir,audio,plan,voiceIdentity};
}

test('concurrent saves with the same revision accept one update and reject the stale update',async()=>{
  const original=await savedProject();
  const first={...structuredClone(original),title:'第一个窗口',createdAt:'cannot-replace-original'};
  const second={...structuredClone(original),title:'第二个窗口'};
  const results=await Promise.allSettled([storage.saveProject(first,1),storage.saveProject(second,1)]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
  if(results[1].status==='rejected')assert.equal(results[1].reason.status,409);
  const saved=await storage.getProject(original.id);
  assert.equal(saved.revision,2);assert.equal(saved.title,'第一个窗口');assert.equal(saved.createdAt,original.createdAt);
});

test('storage round trip preserves exact narration, card copy and source text',async()=>{
  const project=await savedProject();
  const raw='  第一句：AI & a < b，原始数字 1.1。\n\n第二句：保留换行、引号“原文”和空白。  ';
  project.sources=[{id:'source-original',title:'原文',url:'',publisher:'',date:'',note:'用户原稿',text:raw,status:'unverified'}];
  project.scenes[0].narration=raw;project.scenes[0].cards[0].body=raw;project.scenes[0].sourceIds=['source-original'];
  await storage.saveProject(project,1);
  const saved=await storage.getProject(project.id);
  assert.equal(saved.sources[0].text,raw);assert.equal(saved.scenes[0].narration,raw);assert.equal(saved.scenes[0].cards[0].body,raw);
});

test('whole-episode cache refuses a changed audio file even when marker and plan remain',async()=>{
  const project=await savedProject(), fixture=await preparedFixture(project);
  assert.equal((await storage.findPrepared(project))?.job.id,fixture.id);
  await fs.writeFile(fixture.audio,wavFixture(42));
  assert.equal(await storage.findPrepared(project),undefined);
});

test('whole-episode cache requires a published audio-ready marker',async()=>{
  const project=await savedProject(), fixture=await preparedFixture(project);
  await fs.unlink(path.join(fixture.dir,'audio-ready.json'));
  assert.equal(await storage.findPrepared(project),undefined);
});

test('changing the reference path or content invalidates actual voice identity without TTS',async()=>{
  const project=await savedProject(), fixture=await preparedFixture(project);
  try{
    assert.equal((await storage.findPrepared(project))?.job.id,fixture.id);
    process.env.MOYO_KIANA_REFERENCE=referenceB;
    assert.notEqual(await storage.voiceIdentity(project.voice.preset),fixture.voiceIdentity);
    assert.equal(await storage.findPrepared(project),undefined);
    process.env.MOYO_KIANA_REFERENCE=referenceA;
    assert.equal((await storage.findPrepared(project))?.job.id,fixture.id);
    await fs.writeFile(referenceA,wavFixture(3));
    assert.notEqual(await storage.voiceIdentity(project.voice.preset),fixture.voiceIdentity);
    assert.equal(await storage.findPrepared(project),undefined);
  }finally{process.env.MOYO_KIANA_REFERENCE=referenceA;await fs.writeFile(referenceA,wavFixture(1));}
});

test('first initialization with custom voice settings does not relabel the archived recording as that voice',async()=>{
  // All voice paths above deliberately point at this isolated test's fixtures.
  // Historical audio may be retained, but it must not impersonate these inputs.
  await storage.ensureInitialized();
  const imported=await storage.getProject('starrail-demo');
  assert.equal(Boolean(await storage.findPrepared(imported)),false,
    'Archived narration must not match custom voice configuration on first initialization');
});
