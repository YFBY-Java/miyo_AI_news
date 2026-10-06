import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn,execFileSync } from 'node:child_process';
import { compileEpisode, toSrt, validateProject } from '../src/core/project';
import type { Project, VoicePlan } from '../src/core/types';
import { createVideoHtml } from '../src/engine/renderer';
import { fontData } from '../src/server/preview';
import { DATA,ROOT,FIXTURES,atomicJson,readJson,exists,jobPath,runPath,listJobs,findPrepared,mediaUrl,fileHash,voiceIdentity,type StoredJob } from '../src/server/storage';
import { alive,kickWorker } from '../src/server/tasks';
import { resolveImageSources } from '../src/server/images';

const lockPath=path.join(DATA,'worker.lock');
let activeChild:ReturnType<typeof spawn>|undefined;
let stopping=false;
function killChild(){if(activeChild?.pid){try{process.kill(-activeChild.pid,'SIGTERM');}catch{}const pid=activeChild.pid;setTimeout(()=>{try{process.kill(-pid,'SIGKILL');}catch{}},2500).unref();}}
process.on('SIGTERM',()=>{stopping=true;killChild();});process.on('SIGINT',()=>{stopping=true;killChild();});
async function claim(){
  await fs.mkdir(DATA,{recursive:true});
  for(let attempt=0;attempt<3;attempt++){
    try{const f=await fs.open(lockPath,'wx');await f.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));await f.close();return true;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      const lock=await readJson<{pid:number}>(lockPath).catch(()=>undefined);
      if(lock&&alive(lock.pid))return false;
      const stat=await fs.stat(lockPath).catch(()=>undefined);if(!lock&&stat&&Date.now()-stat.mtimeMs<5000)return false;
      await fs.unlink(lockPath).catch(()=>{});
    }
  }return false;
}
async function perform(job:StoredJob){
  const dir=runPath(job.id);const cancel=path.join(dir,'cancel.json');let writes=Promise.resolve();let cancelled=false;
  function update(patch:Partial<StoredJob>){writes=writes.then(async()=>{Object.assign(job,patch,{updatedAt:new Date().toISOString()});await atomicJson(jobPath(job.id),job);});return writes;}
  const poll=setInterval(()=>{void exists(cancel).then(value=>{if(value){cancelled=true;killChild();}});},400);
  async function checkCancelled(){if(cancelled||stopping||await exists(cancel)){cancelled=true;throw new Error('任务已取消');}}
  async function command(executable:string,args:string[],label:string,start:number,span:number){
    await checkCancelled();
    await update({stage:label,message:label,progress:start});
    const log=await fs.open(path.join(dir,label+'.log'),'a');
    try{await new Promise<void>((resolve,reject)=>{
      const child=spawn(executable,args,{cwd:ROOT,detached:true,env:{...process.env,MOYO_ROOT:ROOT,PYTHONUNBUFFERED:'1'},stdio:['ignore','pipe','pipe']});activeChild=child;void update({childPgid:child.pid});
      let buffer='';let tail='';
      child.stdout.on('data',data=>{void log.write(data);buffer+=String(data);const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines){try{const item=JSON.parse(line);if(typeof item.progress==='number')void update({progress:Math.min(99,start+span*item.progress),message:String(item.message||label)});}catch{}}});
      child.stderr.on('data',data=>{void log.write(data);tail=(tail+data).slice(-2500);});
      child.on('error',reject);child.on('close',code=>{activeChild=undefined;void update({childPgid:undefined});if(cancelled||stopping)reject(new Error('任务已取消'));else if(code!==0)reject(new Error(`${label}失败：${tail||'请查看任务日志'}（${code}）`));else resolve();});
    });}finally{await log.close();}
  }
  try{
    await update({status:'running',pid:process.pid,stage:'starting',progress:1,message:'读取本次生成快照'});
    const full=validateProject(await readJson<Project>(path.join(dir,'project.json')));
    await update({voiceIdentity:await voiceIdentity(full.voice.preset)});
    const project=job.kind==='sample'?{...full,scenes:full.scenes.filter(s=>s.id===job.sceneId)}:full;
    if(!project.scenes.length)throw new Error('试听分镜已不存在');
    const imageSources=await resolveImageSources(project);
    const prepared=job.kind==='sample'?undefined:await findPrepared(project);
    if(prepared){
      if(prepared.audio!==path.join(dir,'narration.wav'))await fs.copyFile(prepared.audio,path.join(dir,'narration.wav'));
      await atomicJson(path.join(dir,'voice-plan.json'),prepared.plan);
      await atomicJson(path.join(dir,'audio-provenance.json'),{reusedFrom:prepared.job.id,audioKey:job.audioKey});
      await update({progress:34,message:'复用已完成的配音，更新画面时间轴'});
    }else{
      const input={preset:project.voice.preset,speed:project.voice.speed,scenes:project.scenes.map(s=>({id:s.id,narration:s.narration})),seed:{baseAudio:path.join(FIXTURES,'base-narration.wav'),baseEpisode:path.join(FIXTURES,'base-episode.json'),editorial:path.join(FIXTURES,'editorial.json')}};
      await atomicJson(path.join(dir,'voice-input.json'),input);
      await command(process.env.MOYO_PYTHON||'python3',[path.join(ROOT,'scripts/build_voice.py'),'--input',path.join(dir,'voice-input.json'),'--output',dir,'--cache',path.join(DATA,'cache/voice')],'voice',4,31);
    }
    const plan=await readJson<VoicePlan>(path.join(dir,'voice-plan.json'));
    const episode=compileEpisode(project,plan);
    if(episode.duration>1800)throw new Error('当前一期最长支持 30 分钟，请拆分内容');
    await checkCancelled();
    await atomicJson(path.join(dir,'audio-ready.json'),{audioKey:job.audioKey,voiceIdentity:job.voiceIdentity,sha256:await fileHash(path.join(dir,'narration.wav')),completedAt:new Date().toISOString()});
    await atomicJson(path.join(dir,'episode.json'),episode);await fs.writeFile(path.join(dir,'subtitles.srt'),toSrt(episode));
    await fs.writeFile(path.join(dir,'episode.html'),createVideoHtml(episode,{game:project.game,...project.presentation,fontDataUri:await fontData(),imageSources}));
    const outputs={audio:mediaUrl(path.join(dir,'narration.wav')),preview:mediaUrl(path.join(dir,'episode.html')),subtitles:mediaUrl(path.join(dir,'subtitles.srt')),timeline:mediaUrl(path.join(dir,'episode.json'))};
    await update({outputs,progress:38,stage:'timeline',message:'配音、字幕和卡片时间轴已同步'});
    if(job.kind==='render'){
      await command(process.execPath,['--import','tsx',path.join(ROOT,'scripts/render-video.ts'),'--run',dir],'render',40,56);
      await update({outputs:{...outputs,video:mediaUrl(path.join(dir,'video.mp4')),report:mediaUrl(path.join(dir,'render-report.json'))}});
    }
    await checkCancelled();
    await update({status:'succeeded',stage:'complete',progress:100,message:job.kind==='render'?'视频已导出并通过媒体检查':job.kind==='sample'?'分镜试听已生成':'同步预览已生成'});
  }catch(error){await update({status:cancelled||stopping?'cancelled':'failed',stage:cancelled||stopping?'cancelled':'failed',message:cancelled||stopping?'已取消，已完成的配音缓存可复用':'生成失败，可查看原因后重试',error:String((error as Error).message)});}
  finally{clearInterval(poll);await writes;activeChild=undefined;}
}
async function recoverOrphan(job:StoredJob){
  // Verify ownership against both the saved group and this task's unique path.
  const rows=execFileSync('/bin/ps',['-axo','pid=,pgid=,command='],{encoding:'utf8'}).split('\n');
  const groups=new Set<number>();
  for(const row of rows){const m=/^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row);if(!m)continue;const group=Number(m[2]),command=m[3];
    if(group===job.childPgid&&command.includes(ROOT)&&command.includes(job.id))groups.add(group);
    // Playwright starts Chromium in its own group; our launch marker binds it to this run.
    if(command.includes(`--moyo-task=${runPath(job.id)}`))groups.add(group);
  }
  for(const group of groups){try{process.kill(-group,'SIGTERM');}catch{}}
  if(groups.size)await new Promise(r=>setTimeout(r,1500));
  for(const group of groups){try{process.kill(-group,'SIGKILL');}catch{}}
}
async function main(){
  if(!await claim())return;
  try{
    for(const job of await listJobs())if(job.status==='running'&&(!job.pid||!alive(job.pid))){await recoverOrphan(job);await atomicJson(jobPath(job.id),{...job,childPgid:undefined,status:'failed',stage:'interrupted',message:'上次生成进程已退出，可重试并复用已完成配音',error:'生成进程中断',updatedAt:new Date().toISOString()});}
    let idle=0;
    while(!stopping){
      const next=(await listJobs()).filter(j=>j.status==='queued').reverse()[0];
      if(next){idle=0;if(await exists(path.join(runPath(next.id),'cancel.json'))){await atomicJson(jobPath(next.id),{...next,status:'cancelled',stage:'cancelled',message:'已取消'});continue;}await perform(next);}
      else{if(++idle>=4)break;await new Promise(r=>setTimeout(r,500));}
    }
  }finally{const owner=await readJson<{pid:number}>(lockPath).catch(()=>undefined);if(owner?.pid===process.pid)await fs.unlink(lockPath).catch(()=>{});if(!stopping&&(await listJobs()).some(j=>j.status==='queued'))await kickWorker();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
