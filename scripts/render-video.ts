import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn,execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';
import type { Episode } from '../src/engine/legacy/weekly-episode';

const index=process.argv.indexOf('--run');if(index<0||!process.argv[index+1])throw new Error('缺少 --run 输出目录');
const dir=path.resolve(process.argv[index+1]);const fps=24;
const progress=(v:number,message:string)=>console.log(JSON.stringify({stage:'render',progress:v,message}));
async function main(){
  const episode=JSON.parse(await fs.readFile(path.join(dir,'episode.json'),'utf8')) as Episode;
  const html=await fs.readFile(path.join(dir,'episode.html'),'utf8');
  if(!Number.isFinite(episode.duration)||episode.duration<=0||episode.duration>1800)throw new Error('时长需要在 0–1800 秒内');
  const browser=await chromium.launch({headless:true,args:[`--moyo-task=${dir}`]});let encoder:ReturnType<typeof spawn>|undefined;
  let aborted=false;
  const abort=()=>{aborted=true;encoder?.kill('SIGTERM');void browser.close();};process.once('SIGTERM',abort);process.once('SIGINT',abort);
  try{
    const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent(html,{waitUntil:'load'});await page.waitForSelector('#viewport[data-ready="true"], #viewport[data-ready="error"]',{timeout:30000});
    const expectedImages=episode.scenes.flatMap((scene,sceneIndex)=>scene.cards.flatMap((card,cardIndex)=>card.image?[{sceneIndex,cardIndex,assetId:card.image.assetId}]:[]));
    const imageState=await page.evaluate(()=>({
      ready:document.querySelector<HTMLElement>('#viewport')?.dataset.ready,
      error:document.querySelector<HTMLElement>('#viewport')?.dataset.error,
      images:Array.from(document.querySelectorAll<HTMLImageElement>('img.card-image')).map(img=>({
        sceneIndex:Number(img.closest<HTMLElement>('.scene')?.dataset.scene),
        cardIndex:Number(img.closest<HTMLElement>('.ticket')?.dataset.card),
        assetId:img.dataset.assetId,state:img.dataset.imageState,complete:img.complete,
        width:img.naturalWidth,height:img.naturalHeight,
        embedded:/^data:image\/(png|jpeg|webp);base64,/.test(img.currentSrc||img.src),
        mime:(img.currentSrc||img.src).split(';',1)[0].replace(/^data:/,''),
      })),
    }));
    const failedImages=imageState.images.filter(img=>img.state!=='decoded'||!img.complete||!img.width||!img.height||!img.embedded);
    const missingImages=expectedImages.filter(expected=>!imageState.images.some(actual=>actual.sceneIndex===expected.sceneIndex&&actual.cardIndex===expected.cardIndex&&actual.assetId===expected.assetId));
    const imageChecks={expected:expectedImages.length,total:imageState.images.length,decoded:imageState.images.filter(img=>img.state==='decoded').length,failed:failedImages,missing:missingImages,images:imageState.images,error:imageState.error};
    await fs.writeFile(path.join(dir,'image-check.json'),JSON.stringify(imageChecks,null,2));
    if(imageState.ready!=='true'||failedImages.length||missingImages.length||imageState.images.length!==expectedImages.length)throw new Error('配图检查未通过：'+JSON.stringify(imageChecks));
    const seek=(t:number)=>page.evaluate(time=>(window as any).__weekly.seek(time),t);
    const overflows:unknown[]=[];await fs.mkdir(path.join(dir,'frames'),{recursive:true});
    for(let i=0;i<episode.scenes.length;i++){
      const s=episode.scenes[i];await seek(s.start+Math.min(2,s.duration/2));
      const found=await page.locator('.scene').nth(i).locator('[data-overflow="true"]').allTextContents();if(found.length)overflows.push({scene:s.id,cards:found});
      await page.screenshot({path:path.join(dir,'frames',String(i+1).padStart(2,'0')+'.png')});
    }
    if(errors.length||overflows.length)throw new Error('画面检查未通过：'+JSON.stringify({errors,overflows}));
    await fs.copyFile(path.join(dir,'frames','01.png'),path.join(dir,'poster.png'));
    const temporary=path.join(dir,'video.partial.mp4');
    encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','warning','-f','image2pipe','-framerate',String(fps),'-vcodec','mjpeg','-i','pipe:0','-i',path.join(dir,'narration.wav'),'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','19','-threads','4','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-ar','48000','-t',episode.duration.toFixed(6),'-movflags','+faststart',temporary],{stdio:['pipe','ignore','pipe']});
    let err='';encoder.stderr!.on('data',b=>err=(err+b).slice(-4000));
    let encodeFailure:Error|undefined;
    const completion=new Promise<void>((resolve,reject)=>{encoder!.once('error',reject);encoder!.once('close',c=>c===0?resolve():reject(new Error('视频编码失败：'+err)));});
    completion.catch(e=>{encodeFailure=e;});encoder.stdin!.on('error',e=>{encodeFailure=e;});
    const cdp=await page.context().newCDPSession(page);const count=Math.ceil(episode.duration*fps);
    for(let frame=0;frame<count;frame++){
      if(aborted)throw new Error('渲染已取消');if(encodeFailure)throw encodeFailure;
      await seek(frame/fps);const shot=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:91,fromSurface:true,captureBeyondViewport:false});
      if(!encoder.stdin!.write(Buffer.from(shot.data,'base64')))await once(encoder.stdin!,'drain');
      if(frame%120===0)progress(frame/count*.92,`渲染 ${Math.floor(frame/fps)} / ${Math.ceil(episode.duration)} 秒`);
    }
    encoder.stdin!.end();await completion;progress(.94,'检查音画时长与文件完整性');
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',temporary],{encoding:'utf8'}));
    const video=probe.streams.find((s:any)=>s.codec_type==='video'),audio=probe.streams.find((s:any)=>s.codec_type==='audio');
    if(!video||!audio||video.width!==1920||video.height!==1080||Math.abs(Number(probe.format.duration)-episode.duration)>.15)throw new Error('导出视频音画参数不一致');
    execFileSync('ffmpeg',['-v','error','-i',temporary,'-f','null','-'],{stdio:['ignore','pipe','pipe'],maxBuffer:10_000_000});
    if(errors.length)throw new Error('画面运行错误：'+errors.join(';'));
    await fs.writeFile(path.join(dir,'render-report.json'),JSON.stringify({result:'passed',duration:episode.duration,width:1920,height:1080,fps,frames:count,scenes:episode.scenes.length,pageErrors:errors,overflows,imageChecks,fullDecode:'passed',checkedAt:new Date().toISOString(),streams:probe.streams.map((s:any)=>({type:s.codec_type,codec:s.codec_name,width:s.width,height:s.height,sampleRate:s.sample_rate,channels:s.channels}))},null,2));
    await fs.rename(temporary,path.join(dir,'video.mp4'));progress(1,'完整视频已生成');
  }finally{encoder?.kill('SIGTERM');await browser.close();process.removeListener('SIGTERM',abort);process.removeListener('SIGINT',abort);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
