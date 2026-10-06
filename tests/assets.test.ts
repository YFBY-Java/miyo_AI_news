import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { audioKey, blankProject, compileEpisode, estimatePlan, projectKey, validateProject } from '../src/core/project';
import type { CardImage, ImageAsset, Project } from '../src/core/types';
import { createDirectoryLink, createFileLinkOrSkip } from './helpers/filesystem-links';

let temporary:string;
let images:typeof import('../src/server/images');
let storage:typeof import('../src/server/storage');
let handleApi:typeof import('../src/server/http')['handleApi'];
let png:Buffer, jpeg:Buffer, webp:Buffer;
const savedData=process.env.MOYO_DATA_DIR;
const uploadFile=(bytes:Buffer,name='image.png',type='image/png')=>new File([new Uint8Array(bytes)],name,{type});
const imageConfig=(assetId:string):CardImage=>({assetId,layout:'left',fit:'cover',positionX:50,positionY:50});
function imageProject(assetId:string):Project {
  const project=blankProject('配图测试');project.scenes[0].cards[0].image=imageConfig(assetId);return project;
}
function diskImage(asset:ImageAsset){
  return path.join(storage.DATA,...asset.url.slice('/api/media/'.length).split('/').map(decodeURIComponent));
}
function multipart(file:File){const form=new FormData();form.append('file',file);return new Request('http://localhost/api/assets',{method:'POST',body:form});}
function crc32(bytes:Buffer){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function chunk(name:string,data:Buffer){
  const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length,0);result.write(name,4,'ascii');data.copy(result,8);
  result.writeUInt32BE(crc32(result.subarray(4,-4)),result.length-4);return result;
}
function pngChunks(bytes:Buffer){
  const chunks:{name:string;data:Buffer}[]=[];
  for(let offset=8;offset+12<=bytes.length;){const length=bytes.readUInt32BE(offset);chunks.push({name:bytes.toString('ascii',offset+4,offset+8),data:bytes.subarray(offset+8,offset+8+length)});offset+=length+12;}
  return chunks;
}
async function animatedPng(){
  const a=await sharp({create:{width:2,height:2,channels:3,background:'#ff0000'}}).png().toBuffer();
  const b=await sharp({create:{width:2,height:2,channels:3,background:'#0000ff'}}).png().toBuffer();
  const acTL=Buffer.alloc(8);acTL.writeUInt32BE(2,0);
  const control=(sequence:number)=>{const data=Buffer.alloc(26);data.writeUInt32BE(sequence,0);data.writeUInt32BE(2,4);data.writeUInt32BE(2,8);data.writeUInt16BE(1,20);data.writeUInt16BE(10,22);return chunk('fcTL',data);};
  const first=pngChunks(a),second=pngChunks(b),secondIdat=Buffer.concat(second.filter(c=>c.name==='IDAT').map(c=>c.data));
  const fdAT=Buffer.alloc(4+secondIdat.length);fdAT.writeUInt32BE(2,0);secondIdat.copy(fdAT,4);
  return Buffer.concat([a.subarray(0,8),chunk('IHDR',first.find(c=>c.name==='IHDR')!.data),chunk('acTL',acTL),control(0),
    ...first.filter(c=>c.name==='IDAT').map(c=>chunk('IDAT',c.data)),control(1),chunk('fdAT',fdAT),chunk('IEND',Buffer.alloc(0))]);
}

before(async()=>{
  temporary=await fs.mkdtemp(path.join(os.tmpdir(),'miyo-assets-test-'));
  process.env.MOYO_DATA_DIR=path.join(temporary,'data');
  await fs.mkdir(process.env.MOYO_DATA_DIR);
  await fs.writeFile(path.join(process.env.MOYO_DATA_DIR,'initialized.json'),'{}');
  [images,storage,{handleApi}]=await Promise.all([import('../src/server/images'),import('../src/server/storage'),import('../src/server/http')]);
  const raw=Buffer.from(Array.from({length:6*4*3},(_,index)=>(index*37)%256));
  png=await sharp(raw,{raw:{width:6,height:4,channels:3}}).png().toBuffer();
  jpeg=await sharp(raw,{raw:{width:6,height:4,channels:3}}).jpeg().toBuffer();
  webp=await sharp(raw,{raw:{width:6,height:4,channels:3}}).webp().toBuffer();
});
after(async()=>{await fs.rm(temporary,{recursive:true,force:true});if(savedData===undefined)delete process.env.MOYO_DATA_DIR;else process.env.MOYO_DATA_DIR=savedData;});

test('PNG, JPEG and static WebP preserve original bytes and expose their decoded MIME',async()=>{
  for(const [bytes,name,mime] of [[png,'像素图.png','image/png'],[jpeg,'误写的后缀.png','image/jpeg'],[webp,'像素图.webp','image/webp']] as const){
    const asset=await images.storeImage(uploadFile(bytes,name,'image/png'));
    assert.equal(asset.mime,mime);assert.equal(asset.width,6);assert.equal(asset.height,4);assert.equal(asset.size,bytes.length);assert.equal(asset.name,name);
    assert.deepEqual(await fs.readFile(diskImage(asset)),bytes);
    const response=await handleApi(new Request('http://localhost'+asset.url));
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),mime);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  }
});

test('same-name uploads are immutable distinct assets and original filenames cannot set disk paths',async()=>{
  const first=await images.storeImage(uploadFile(png,'../../same.png'));
  const second=await images.storeImage(uploadFile(jpeg,'../../same.png'));
  assert.notEqual(first.id,second.id);assert.notEqual(first.url,second.url);
  assert.equal(first.name,'../../same.png');assert.match(first.url,/^\/api\/media\/assets\/[\da-f-]+\/image\.png$/);
  assert.deepEqual(await fs.readFile(diskImage(first)),png);assert.deepEqual(await fs.readFile(diskImage(second)),jpeg);
  assert.equal((await images.listImages()).filter(a=>a.id===first.id||a.id===second.id).length,2);
});

test('JPEG EXIF orientation changes display dimensions without changing uploaded bytes',async()=>{
  const oriented=await sharp(jpeg).withMetadata({orientation:6}).jpeg().toBuffer();
  const asset=await images.storeImage(uploadFile(oriented,'rotated.jpg','image/jpeg'));
  assert.equal(asset.width,4);assert.equal(asset.height,6);
  assert.deepEqual(await fs.readFile(diskImage(asset)),oriented);
});

test('SVG MIME disguise and truncated supported files fail before an asset is published',async()=>{
  const count=(await images.listImages()).length;
  await assert.rejects(images.storeImage(uploadFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'),'fake.png','image/png')));
  await assert.rejects(images.storeImage(uploadFile(png.subarray(0,40),'truncated.png')));
  assert.equal((await images.listImages()).length,count);
});

test('real two-frame APNG and WebP are rejected as animated input',async()=>{
  const apng=await animatedPng();assert.equal((await sharp(apng).metadata()).width,2);
  await assert.rejects(images.storeImage(uploadFile(apng,'motion.png')),/静态|APNG/);
  const raw=Buffer.from([255,0,0,255,0,0,255,0,0,255,0,0,0,0,255,0,0,255,0,0,255,0,0,255]);
  const animated=await sharp(raw,{raw:{width:2,height:4,channels:3,pageHeight:2}}).webp({loop:0,delay:[100,100]}).toBuffer();
  assert.equal((await sharp(animated,{animated:true}).metadata()).pages,2);
  await assert.rejects(images.storeImage(uploadFile(animated,'motion.webp','image/webp')),/静态|动态/);
});

test('pixel and upload size limits reject oversized inputs without rewriting them',async()=>{
  const big=await sharp({create:{width:6401,height:5000,channels:3,background:'#000000'}}).png().toBuffer();
  assert.ok(big.length<images.MAX_IMAGE_BYTES);assert.ok(6401*5000>images.MAX_IMAGE_PIXELS);
  await assert.rejects(images.storeImage(uploadFile(big,'too-many-pixels.png')),/3200|尺寸/);
  const oversized=Buffer.alloc(images.MAX_IMAGE_BYTES+1);png.copy(oversized);
  await assert.rejects(images.storeImage(uploadFile(oversized,'too-many-bytes.png')),(error:any)=>error.status===413);
});

test('multipart reader bounds actual bytes when Content-Length is absent or forged',async()=>{
  for(const length of [undefined,'1']){
    let cancelled=false,produced=0;const chunkSize=256*1024;
    const body=new ReadableStream<Uint8Array>({pull(controller){produced+=chunkSize;controller.enqueue(new Uint8Array(chunkSize));},cancel(){cancelled=true;}});
    const request=new Request('http://localhost/api/assets',{method:'POST',body,duplex:'half',headers:{'content-type':'multipart/form-data; boundary=test',...(length?{'content-length':length}:{})}} as RequestInit);
    await assert.rejects(images.readImageUpload(request),(error:any)=>error.status===413);
    assert.equal(cancelled,true);assert.ok(produced<=images.MAX_IMAGE_BYTES+64*1024+2*chunkSize);
  }
  const valid=await images.readImageUpload(multipart(uploadFile(png)));
  assert.deepEqual(Buffer.from(await valid.arrayBuffer()),png);
  const form=new FormData();form.append('file',uploadFile(png));form.append('file',uploadFile(jpeg));
  await assert.rejects(images.readImageUpload(new Request('http://localhost/api/assets',{method:'POST',body:form})),/一次上传一张/);
});

test('image identity paths and SHA prevent escape and same-length content replacement',async()=>{
  await assert.rejects(images.getImage('../outside'));
  const asset=await images.storeImage(uploadFile(png));const imagePath=diskImage(asset);
  const changed=Buffer.from(png);changed[changed.length-1]^=1;await fs.writeFile(imagePath,changed);
  await assert.rejects(images.resolveImageSources(imageProject(asset.id)),/内容已变化/);
});

test('a file symlink cannot redirect image bytes outside DATA',async(context)=>{
  const linked=await images.storeImage(uploadFile(png,'linked.png'));const linkedPath=diskImage(linked);
  const outside=path.join(temporary,'outside.png');await fs.writeFile(outside,png);await fs.unlink(linkedPath);
  try{
    if(!await createFileLinkOrSkip(context,outside,linkedPath))return;
    await assert.rejects(images.resolveImageSources(imageProject(linked.id)),(error:any)=>error.status===403);
  }finally{await fs.rm(linkedPath,{force:true});await fs.writeFile(linkedPath,png);}
});

test('a file symlink cannot redirect image metadata outside DATA',async(context)=>{
  const metadata=await images.storeImage(uploadFile(png,'metadata.png'));const metadataPath=path.join(path.dirname(diskImage(metadata)),'metadata.json');
  const outsideMetadata=path.join(temporary,'outside-metadata.json');await fs.copyFile(metadataPath,outsideMetadata);await fs.unlink(metadataPath);
  try{
    if(!await createFileLinkOrSkip(context,outsideMetadata,metadataPath))return;
    await assert.rejects(images.getImage(metadata.id),(error:any)=>error.status===403);
  }finally{await fs.rm(metadataPath,{force:true});await fs.copyFile(outsideMetadata,metadataPath);}
});

test('the entire asset directory cannot be redirected outside DATA for reads or writes',async()=>{
  const asset=await images.storeImage(uploadFile(png,'root-test.png'));
  const library=path.join(storage.DATA,'assets'),backup=path.join(storage.DATA,'assets-backup');
  const outside=path.join(temporary,'outside-assets');await fs.mkdir(outside);
  await fs.cp(path.join(library,asset.id),path.join(outside,asset.id),{recursive:true});
  await fs.rename(library,backup);
  try{
    await createDirectoryLink(outside,library);
    await assert.rejects(images.getImage(asset.id),(error:any)=>error.status===403);
    await assert.rejects(images.storeImage(uploadFile(png,'outside-write.png')),(error:any)=>error.status===403);
    assert.deepEqual(await fs.readdir(outside),[asset.id]);
  }finally{await fs.unlink(library).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;});await fs.rename(backup,library);}
});

test('image settings survive validation and compilation while only visual project key changes',()=>{
  const plain=blankProject(),originalAudio=audioKey(plain),originalProject=projectKey(plain);
  const project=structuredClone(plain);const image={assetId:'image-test',layout:'background' as const,fit:'contain' as const,positionX:0,positionY:100};
  project.scenes[0].cards[0].image=image;
  const saved=validateProject(project);assert.deepEqual(saved.scenes[0].cards[0].image,image);
  assert.equal(audioKey(saved),originalAudio);assert.notEqual(projectKey(saved),originalProject);
  assert.deepEqual(compileEpisode(saved,estimatePlan(saved)).scenes[0].cards[0].image,image);
  for(const invalid of [{layout:'arbitrary'},{fit:'fill'},{positionX:NaN},{positionY:101},{assetId:'../escape'}]){
    const bad=structuredClone(project);Object.assign(bad.scenes[0].cards[0].image!,invalid);assert.throws(()=>validateProject(bad));
  }
});

test('changing current image does not alter the persisted task snapshot or its resolved original bytes',async()=>{
  const first=await images.storeImage(uploadFile(png,'first.png')),second=await images.storeImage(uploadFile(jpeg,'second.jpg','image/jpeg'));
  const original=validateProject(imageProject(first.id));
  await storage.atomicJson(storage.projectPath(original.id),original);
  const snapshot=path.join(storage.DATA,'runs','snapshot-test','project.json');await storage.atomicJson(snapshot,original);
  const before=JSON.stringify(original),sourceA=await images.resolveImageSources(original);
  assert.equal(JSON.stringify(original),before);assert.equal(sourceA[first.id],`data:image/png;base64,${png.toString('base64')}`);
  const current=structuredClone(original);current.scenes[0].cards[0].image=imageConfig(second.id);
  await storage.saveProject(current,original.revision);
  const archived=await storage.readJson<Project>(snapshot),latest=await storage.getProject(original.id);
  assert.deepEqual(await images.resolveImageSources(archived),sourceA);
  assert.equal((await images.resolveImageSources(latest))[second.id],`data:image/jpeg;base64,${jpeg.toString('base64')}`);
  assert.deepEqual(await fs.readFile(diskImage(first)),png);
});

test('assets HTTP routes upload/list real bytes and project save rejects missing image references',async()=>{
  const created=await handleApi(multipart(uploadFile(webp,'HTTP配图.webp','image/webp')));assert.equal(created.status,201);
  const {asset}=await created.json() as {asset:ImageAsset};assert.equal(asset.mime,'image/webp');
  const listed=await handleApi(new Request('http://localhost/api/assets'));assert.equal(listed.status,200);
  assert.ok((await listed.json()).assets.some((entry:ImageAsset)=>entry.id===asset.id));
  const project=blankProject();await storage.atomicJson(storage.projectPath(project.id),project);
  project.scenes[0].cards[0].image=imageConfig('missing-asset');
  const response=await handleApi(new Request('http://localhost/api/projects/'+project.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({project,expectedRevision:1})}));
  assert.equal(response.status,404);assert.equal((await storage.getProject(project.id)).revision,1);
});
