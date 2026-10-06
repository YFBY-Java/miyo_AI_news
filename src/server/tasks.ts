import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { audioKey, projectKey, uid, InputError } from '../core/project';
import type { JobKind, Project } from '../core/types';
import { DATA, ROOT, atomicJson, jobPath, runPath, listJobs, getJob, readJson, serialized, voiceIdentity, type StoredJob } from './storage';

export function alive(pid:number){try{process.kill(pid,0);return true;}catch{return false;}}
export async function kickWorker(){
  const lock=await readJson<{pid:number}>(path.join(DATA,'worker.lock')).catch(()=>undefined);
  if(lock&&alive(lock.pid))return;
  const log=await fs.open(path.join(DATA,'logs','worker.log'),'a');
  try{
    const child=spawn(process.execPath,['--import','tsx',path.join(ROOT,'scripts/worker.ts')],{cwd:ROOT,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,MOYO_ROOT:ROOT,MOYO_DATA_DIR:DATA}});
    await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  }finally{await log.close();}
}
export async function createJob(project:Project,kind:JobKind,sceneId?:string){
  if(!['prepare','render','sample'].includes(kind))throw new InputError('生成任务类型无效');
  if(kind==='sample'&&!project.scenes.some(s=>s.id===sceneId))throw new InputError('请先选择一个分镜试听');
  return serialized(async()=>{
    const key=projectKey(project);
    const duplicate=(await listJobs(project.id)).find(j=>j.kind===kind&&j.sceneId===sceneId&&j.projectKey===key&&['queued','running'].includes(j.status));
    if(duplicate){await kickWorker();return duplicate;}
    const now=new Date().toISOString();const id=uid();const job:StoredJob={id,projectId:project.id,revision:project.revision,kind,sceneId,status:'queued',stage:'queued',progress:0,message:'等待生成',createdAt:now,updatedAt:now,audioKey:audioKey(project),projectKey:key,voiceIdentity:await voiceIdentity(project.voice.preset)};
    await atomicJson(path.join(runPath(id),'project.json'),project);await atomicJson(jobPath(id),job);await kickWorker();return job;
  });
}
export async function cancelJob(id:string){
  const job=await getJob(id);if(!['queued','running'].includes(job.status))return job;
  await atomicJson(path.join(runPath(id),'cancel.json'),{at:new Date().toISOString()});
  if(job.status==='queued'){job.status='cancelled';job.stage='cancelled';job.message='已取消';job.updatedAt=new Date().toISOString();await atomicJson(jobPath(id),job);}
  return {...job,message:job.status==='running'?'正在取消…':job.message};
}
