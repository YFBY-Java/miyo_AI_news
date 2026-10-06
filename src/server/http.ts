import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { InputError,blankProject,newScene,uid,validateProject } from '../core/project';
import { GAMES,type Capability,type Game,type Project } from '../core/types';
import { ROOT,DATA,atomicJson,ensureInitialized,exists,getProject,getJob,importFixture,jobPath,listJobs,listProjects,projectPath,saveProject } from './storage';
import { htmlForProject,projectResponse } from './preview';
import { cancelJob,createJob,kickWorker } from './tasks';
import { importSource } from './sources';
import { assertProjectImages, listImages, readImageUpload, storeImage } from './images';

const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
async function body(request:Request){const text=await request.text();if(Buffer.byteLength(text)>2_000_000)throw new InputError('提交内容超过 2MB',413);try{return JSON.parse(text);}catch{throw new InputError('无法解析提交内容');}}
let capabilityCache:{at:number;value:Capability[]}|undefined;
async function capabilities(){
  if(capabilityCache&&Date.now()-capabilityCache.at<30_000)return capabilityCache.value;
  const python=process.env.MOYO_MLX_PYTHON||'/Users/shuidi/Documents/Codex/2026-09-25/ruh/work/jev-video/.venv_mlx_audio/bin/python';
  const voice=process.env.MOYO_KIANA_VOICE_DIR||path.resolve(ROOT,'voice-library/琪亚娜-稳重轻角色感');
  const model=process.env.MOYO_KIANA_MODEL||path.join(process.env.HOME||'', '.cache/huggingface/hub/models--mlx-community--Qwen3-TTS-12Hz-1.7B-Base-4bit/snapshots/37e955a1deb861c088ae5f3a67043185f3d1a60c');
  const kiana=await exists(python)&&await exists(path.join(voice,'kiana_refs_concat_v2_light.wav'))&&await exists(model);
  const ffmpeg=spawnSync('ffmpeg',['-version'],{timeout:3000,stdio:'ignore'}).status===0;
  const edge=spawnSync('edge-tts',['--version'],{timeout:3000,stdio:'ignore'}).status===0;
  const value=[{id:'kiana-base',label:'琪亚娜 · 稳重轻角色感 · 基准',available:kiana,detail:kiana?'本地声线资源已就绪':'本地声线或模型未找到；原版示例仍可复用已保存配音'},{id:'xiaoxiao',label:'晓晓 · 普通话',available:edge,detail:'在线合成，需要网络'},{id:'video',label:'视频导出',available:ffmpeg,detail:ffmpeg?'1080p · 24fps · MP4':'未找到 FFmpeg，请检查本机工具路径'}];
  capabilityCache={at:Date.now(),value};return value;
}
async function asset(request:Request,parts:string[]){
  const file=path.resolve(DATA,...parts);const root=await fs.realpath(DATA);const resolved=await fs.realpath(file).catch(()=>{throw new InputError('文件不存在',404);});
  if(!resolved.startsWith(root+path.sep))throw new InputError('不可访问此文件',403);
  const stat=await fs.stat(resolved);if(!stat.isFile())throw new InputError('文件不存在',404);
  const mime:Record<string,string>={'.wav':'audio/wav','.m4a':'audio/mp4','.mp4':'video/mp4','.webm':'video/webm','.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.srt':'application/x-subrip; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.log':'text/plain; charset=utf-8'};
  const headers:Record<string,string>={'Content-Type':mime[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(new URL(request.url).searchParams.has('download'))headers['Content-Disposition']="attachment; filename*=UTF-8''"+encodeURIComponent(path.basename(file));
  if(stat.size===0)return new Response(null,{status:200,headers:{...headers,'Content-Length':'0'}});
  const range=request.headers.get('range');let start=0,end=stat.size-1,status=200;
  if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${stat.size}`}});
    if(!match[1])start=Math.max(0,stat.size-Number(match[2]));else start=Number(match[1]);if(match[1]&&match[2])end=Math.min(end,Number(match[2]));
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start<0||start>=stat.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${stat.size}`}});
    status=206;headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length']=String(Math.max(0,end-start+1));
  return new Response(Readable.toWeb(createReadStream(resolved,{start,end})) as ReadableStream,{status,headers});
}
export async function handleApi(request:Request):Promise<Response>{
  try{
    const url=new URL(request.url);const parts=url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
    const host=request.headers.get('host')||url.host;
    const effectiveOrigin=new URL(url.protocol+'//'+host);
    if(!['localhost','127.0.0.1','[::1]'].includes(effectiveOrigin.hostname))throw new InputError('此工作台仅接受本机访问',403);
    if(!['GET','HEAD'].includes(request.method)){
      const origin=request.headers.get('origin');if(origin&&origin!==effectiveOrigin.origin)throw new InputError('此操作只能从本地工作台发起',403);
      const site=request.headers.get('sec-fetch-site');if(site==='cross-site')throw new InputError('不接受跨站写入',403);
    }
    await ensureInitialized();
    if(parts[0]==='media'&&request.method==='GET')return await asset(request,parts.slice(1));
    if(parts[0]==='assets'&&parts.length===1){
      if(request.method==='GET')return json({assets:await listImages()});
      if(request.method==='POST')return json({asset:await storeImage(await readImageUpload(request))},201);
    }
    if(parts[0]==='projects'&&parts.length===1){
      if(request.method==='GET'){
        const jobs=await listJobs();if(jobs.some(j=>j.status==='queued'||j.status==='running'))void kickWorker();
        return json({projects:await listProjects(),jobs,capabilities:await capabilities()});
      }
      if(request.method==='POST'){
        const input=await body(request);let p:Project;
        if(input.template==='starrail-weekly')p=await importFixture();
        else if(input.template==='duplicate'){
          const original=await getProject(input.sourceId);p={...original,id:uid(),revision:1,title:input.title||original.title+' · 副本',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
        }else if(input.template==='blank')p=blankProject(input.title||'新一期米游资讯',input.game||'starrail');
        else throw new InputError('未知的项目模板');
        if(input.title)p.title=input.title;if(input.game)p.game=input.game;
        p=validateProject(p);await assertProjectImages(p);await atomicJson(projectPath(p.id),p);return json({project:p},201);
      }
    }
    if(parts[0]==='projects'&&parts[1]){
      const p=await getProject(parts[1]);
      if(parts.length===2){if(request.method==='GET'){if((await listJobs(p.id)).some(j=>j.status==='queued'||j.status==='running'))void kickWorker();return json(await projectResponse(p));}if(request.method==='PUT'){const input=await body(request);if(input.project?.id!==p.id)throw new InputError('项目编号不一致');const draft=validateProject(input.project);await assertProjectImages(draft);return json(await projectResponse(await saveProject(draft,input.expectedRevision)));}}
      if(parts[2]==='preview'&&request.method==='GET')return new Response(await htmlForProject(p),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
      if(parts[2]==='jobs'&&request.method==='POST'){const input=await body(request);return json({job:await createJob(p,input.kind,input.sceneId)},202);}
      if(parts[2]==='compose'&&request.method==='POST'){
        const input=await body(request);if(typeof input.text!=='string'||!input.text.trim()||input.text.length>60000)throw new InputError('请粘贴 1–60000 字的资料正文');
        if(input.sourceId&&!p.sources.some(s=>s.id===input.sourceId))throw new InputError('请先保存该来源');
        const paragraphs=input.text.trim().split(/\n\s*\n|\n(?=[一二三四五六七八九十\d]+[、.．])/).filter(Boolean);
        if(paragraphs.some(s=>s.length>8000))throw new InputError('单段超过 8000 字，请先按选题分段');
        if(paragraphs.length>20)throw new InputError('一次最多整理 20 段，请选取需要的内容');
        const scenes=paragraphs.map((text,i)=>{const lines=text.split('\n');const title=lines[0].length<=70?lines[0]:`资讯草稿 ${i+1}`;const scene=newScene(title,text);const sentences=text.match(/[^。！？\n]+[。！？]?/g)||[text];const groups:string[]=[];let current='';for(const s of sentences){if(current.length+s.length>150&&current){groups.push(current);current='';}current+=s;}if(current)groups.push(current);
          const cardText=groups.slice(0,6);if(groups.length>6)throw new InputError('一段内容需要超过 6 张卡片，请拆成多个选题');
          scene.cards=cardText.map((part,n)=>({id:uid(),label:'待核对',title:n===0?title:`要点 ${n+1}`,body:part}));scene.focus=scene.cards.map((c,n)=>({at:n/scene.cards.length,cardId:c.id,transition:'classic'}));scene.sourceIds=input.sourceId?[input.sourceId]:[];return scene;});
        const updated=await saveProject({...p,scenes:input.replace?scenes:[...p.scenes,...scenes]},p.revision);return json(await projectResponse(updated));
      }
    }
    if(parts[0]==='jobs'&&parts[1]){
      if(parts.length===2&&request.method==='GET'){const job=await getJob(parts[1]);if(['queued','running'].includes(job.status))void kickWorker();return json({job});}
      if(parts[2]==='cancel'&&request.method==='POST')return json({job:await cancelJob(parts[1])});
    }
    if(parts[0]==='sources'&&parts[1]==='import'&&request.method==='POST'){const input=await body(request);if(typeof input.url!=='string'||input.url.length>2500)throw new InputError('请输入有效链接');return json({source:await importSource(input.url)});}
    if(parts[0]==='health'&&request.method==='GET')return json({ok:true,project:'miyo_AI_news',capabilities:await capabilities()});
    return json({error:'接口不存在'},404);
  }catch(error){console.error('[miyo]',(error as Error).message);return json({error:error instanceof InputError?error.message:(error as Error).message||'操作失败'},error instanceof InputError?error.status:500);}
}
