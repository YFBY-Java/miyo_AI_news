import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { audioKey, blankProject, safeId, validateProject, InputError } from '../core/project';
import type { Project, Job, VoicePlan } from '../core/types';
import { ROOT, resolveProjectPath, kianaPaths, runtimeEnvironment } from './runtime';

export { ROOT };
export const DATA=resolveProjectPath(process.env.MOYO_DATA_DIR || 'data');
export const FIXTURES=path.join(ROOT,'fixtures/starrail-weekly');
export const projectPath=(id:string)=>path.join(DATA,'projects',safeId(id)+'.json');
export const jobPath=(id:string)=>path.join(DATA,'jobs',safeId(id)+'.json');
export const runPath=(id:string)=>path.join(DATA,'runs',safeId(id));
export async function readJson<T>(file:string):Promise<T>{return JSON.parse(await fs.readFile(file,'utf8'));}
export async function atomicJson(file:string,data:unknown){await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(data,null,2)+'\n');await fs.rename(tmp,file);}
export async function exists(file:string){try{await fs.access(file);return true;}catch{return false;}}
export interface StoredJob extends Job { audioKey:string; projectKey:string; voiceIdentity?:string; pid?:number; childPgid?:number; childProcess?:{pid:number;startedAt:string;runDirectory:string}; cancelRequested?:boolean }
export async function fileHash(file:string){return createHash('sha256').update(await fs.readFile(file)).digest('hex');}
export async function voiceIdentity(preset:string){
  const {model,reference,referenceText,presets}=kianaPaths();
  const files=[path.join(ROOT,'scripts/build_voice.py')];
  if(preset==='kiana-base')files.push(reference,referenceText,presets,path.join(model,'config.json'));
  const identities=await Promise.all(files.map(async file=>({file,sha256:await fileHash(file).catch(()=>null)})));
  const config=Object.fromEntries(Object.entries(runtimeEnvironment()).filter(([key])=>/^MOYO_(KIANA|MLX|FFMPEG|FFPROBE|EDGE_TTS)/.test(key)).sort());
  return createHash('sha256').update(JSON.stringify({preset,model,identities,config})).digest('hex');
}
export async function listProjects():Promise<Project[]>{
  const names=await fs.readdir(path.join(DATA,'projects')).catch(()=>[] as string[]);
  return (await Promise.all(names.filter(n=>n.endsWith('.json')).map(n=>readJson<Project>(path.join(DATA,'projects',n))))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export async function getProject(id:string){try{return await readJson<Project>(projectPath(id));}catch{throw new InputError('项目不存在',404);}}
export async function listJobs(projectId?:string):Promise<StoredJob[]>{
  const names=await fs.readdir(path.join(DATA,'jobs')).catch(()=>[] as string[]);
  const jobs=await Promise.all(names.filter(n=>n.endsWith('.json')).map(n=>readJson<StoredJob>(path.join(DATA,'jobs',n))));
  return jobs.filter(j=>!projectId||j.projectId===projectId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export async function getJob(id:string){try{return await readJson<StoredJob>(jobPath(id));}catch{throw new InputError('任务不存在',404);}}
export function mediaUrl(file:string){const relative=path.relative(DATA,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Asset outside project data');return '/api/media/'+relative.split(path.sep).map(encodeURIComponent).join('/');}
const shared=globalThis as typeof globalThis & {moyoInit?:Promise<void>;moyoEdits?:Promise<unknown>};
export function serialized<T>(fn:()=>Promise<T>):Promise<T>{const result=(shared.moyoEdits||Promise.resolve()).then(fn,fn);shared.moyoEdits=result.catch(()=>{});return result;}
export async function saveProject(p:unknown, expectedRevision:number){return serialized(async()=>{const draft=validateProject(p);const current=await getProject(draft.id);if(current.revision!==expectedRevision)throw new InputError('项目已在另一个窗口更新，请刷新后再保存',409);const saved={...draft,createdAt:current.createdAt,updatedAt:new Date().toISOString(),revision:current.revision+1};await atomicJson(projectPath(saved.id),saved);return saved;});}
export async function importFixture(id:string=randomUUID()):Promise<Project>{
  const editorial=await readJson<any>(path.join(FIXTURES,'editorial.json'));
  const episode=await readJson<any>(path.join(FIXTURES,'final-episode.json'));
  const p=blankProject('星铁周报 · 原版导入','starrail');p.id=id;p.origin='miyo-news-card @ a11a118';p.period=episode.period;p.cutoff=episode.cutoff;
  p.sources=editorial.sources.map((s:any)=>({...s,text:'',status:/社区|讨论|玩家|样本/.test(s.note+' '+s.publisher)?'community':'verified'}));
  p.scenes=episode.scenes.map((s:any)=>({...s,cards:s.cards.map((c:any,i:number)=>({...c,id:s.id+'-card-'+i})),narration:editorial.scenes.find((v:any)=>v.id===s.id).narration,subtitle:s.subtitle||'',kicker:s.kicker||'',metric:s.metric||'',focus:s.focusCues.map((f:any)=>({at:f.start/s.duration,cardId:s.id+'-card-'+f.cardIndex,transition:f.transition||'classic'}))}));
  const checked=validateProject(p);await atomicJson(projectPath(p.id),checked);return checked;
}
async function initialize(){
  for(const name of ['projects','jobs','runs','cache','logs'])await fs.mkdir(path.join(DATA,name),{recursive:true});
  if(await exists(path.join(DATA,'initialized.json')))return;
  // Exclusive initialization claim prevents duplicated demo projects across requests.
  const claim=path.join(DATA,'initialize.lock');let handle;
  try{handle=await fs.open(claim,'wx');await handle.writeFile(JSON.stringify({pid:process.pid}));}catch{for(let i=0;i<100;i++){if(await exists(path.join(DATA,'initialized.json')))return;const owner=await readJson<{pid:number}>(claim).catch(()=>undefined);let running=false;if(owner?.pid){try{process.kill(owner.pid,0);running=true;}catch{}}const stat=await fs.stat(claim).catch(()=>undefined);if(!running&&(!stat||Date.now()-stat.mtimeMs>5000)){await fs.unlink(claim).catch(()=>{});return initialize();}await new Promise(r=>setTimeout(r,50));}throw new Error('项目初始化仍在进行');}
  try{
    const p=await importFixture('starrail-demo');
    const episode=await readJson<any>(path.join(FIXTURES,'final-episode.json'));
    const id='imported-baseline';const dir=runPath(id);await fs.mkdir(dir,{recursive:true});
    await fs.copyFile(path.join(FIXTURES,'final-narration.wav'),path.join(dir,'narration.wav'));
    const plan:VoicePlan={duration:episode.duration,preset:p.voice.preset,speed:p.voice.speed,audioFile:'narration.wav',scenes:episode.scenes.map((s:any)=>({id:s.id,duration:s.duration,cues:episode.cues.filter((c:any)=>c.start>=s.start-.001&&c.start<s.start+s.duration-.001).map((c:any)=>({...c,start:c.start-s.start,end:Math.min(s.duration,c.end-s.start)}))}))};
    await atomicJson(path.join(dir,'voice-plan.json'),plan);await atomicJson(path.join(dir,'project.json'),p);
    const customVoice=['MOYO_MLX_PYTHON','MOYO_KIANA_MODEL','MOYO_KIANA_VOICE_DIR','MOYO_KIANA_REFERENCE','MOYO_KIANA_REFERENCE_TEXT','MOYO_KIANA_PRESETS'].some(key=>Object.hasOwn(process.env,key));
    const identity=customVoice?'archived-original-kiana-base':await voiceIdentity(p.voice.preset);
    await atomicJson(path.join(dir,'audio-ready.json'),{audioKey:audioKey(p),voiceIdentity:identity,sha256:await fileHash(path.join(dir,'narration.wav'))});
    const job:StoredJob={id,projectId:p.id,revision:1,kind:'prepare',status:'succeeded',stage:'complete',progress:100,message:'已导入原版配音和精确时间轴',createdAt:p.createdAt,updatedAt:p.updatedAt,audioKey:audioKey(p),voiceIdentity:identity,projectKey:'imported',outputs:{audio:mediaUrl(path.join(dir,'narration.wav'))}};
    await atomicJson(jobPath(id),job);await atomicJson(path.join(DATA,'initialized.json'),{createdAt:new Date().toISOString()});
  }finally{await handle.close();await fs.unlink(claim).catch(()=>{});}
}
export function ensureInitialized(){return shared.moyoInit ||= initialize().catch(error=>{shared.moyoInit=undefined;throw error;});}
export async function findPrepared(p:Project):Promise<{job:StoredJob;plan:VoicePlan;audio:string}|undefined>{
  const key=audioKey(p),identity=await voiceIdentity(p.voice.preset);
  for(const job of await listJobs(p.id)){
    if(job.audioKey===key && job.kind!=='sample' && job.voiceIdentity===identity && await exists(path.join(runPath(job.id),'voice-plan.json')) && await exists(path.join(runPath(job.id),'narration.wav'))){
      const marker=await readJson<{sha256:string;voiceIdentity:string}>(path.join(runPath(job.id),'audio-ready.json')).catch(()=>undefined);
      if(marker?.voiceIdentity===identity&&marker.sha256===await fileHash(path.join(runPath(job.id),'narration.wav')))return {job,plan:await readJson<VoicePlan>(path.join(runPath(job.id),'voice-plan.json')),audio:path.join(runPath(job.id),'narration.wav')};
    }
  }
}
