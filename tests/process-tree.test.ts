import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { captureTaskProcess, listProcesses, recoverTaskProcesses, terminateTaskProcess } from '../src/server/process-tree';
import { audioKey, blankProject, projectKey } from '../src/core/project';
import { pythonCommand } from '../src/server/runtime';

const pause = (ms:number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor<T>(read:()=>Promise<T>, timeout=15_000):Promise<T> {
  const until=Date.now()+timeout;
  while(Date.now()<until){try{const value=await read();if(value)return value;}catch{}await pause(100);}
  throw new Error('Timed out waiting for child process fixture');
}
async function fixture(){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'moyo process 中文 '));
  const script=path.join(directory,'process.cjs');
  await fs.writeFile(script,`
    const fs=require('node:fs');const path=require('node:path');const {spawn}=require('node:child_process');
    const [run,role]=process.argv.slice(2);
    fs.writeFileSync(path.join(run,role+'.pid'),String(process.pid));
    function child(role,detached=false){spawn(process.execPath,[__filename,run,role,...(detached?['--moyo-task='+run]:[])],{detached,windowsHide:true,stdio:'ignore'});}
    if(role==='root'){child('child');child('browser',true);}
    if(role==='child')child('grandchild');
    setInterval(()=>{},1000);
  `);
  return {directory,script};
}
async function launch(script:string,run:string,role='root'){
  await fs.mkdir(run,{recursive:true});
  const child=spawn(process.execPath,[script,run,role],{detached:true,windowsHide:true,stdio:'ignore'});
  await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  child.unref();
  return child;
}
async function pid(run:string,role:string){return waitFor(async()=>Number(await fs.readFile(path.join(run,role+'.pid'),'utf8')));}
async function cleanup(children:ChildProcess[],directory:string){
  // Fixture cleanup is independent of the implementation under test, including red runs.
  for(const row of await listProcesses()){
    if(!row.command.includes(path.join(directory,'process.cjs'))&&!row.command.includes(path.join(directory,'scripts','build_voice.py')))continue;
    try{
      if(process.platform==='win32')execFileSync(path.join(process.env.SystemRoot!,'System32','taskkill.exe'),['/PID',String(row.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      else process.kill(row.pid,'SIGKILL');
    }catch{}
  }
  await fs.rm(directory,{recursive:true,force:true});
}

test('cancelling a real task waits for children, grandchildren and a detached browser to exit',async()=>{
  const {directory,script}=await fixture();const run=path.join(directory,'runs','task-1');const children:ChildProcess[]=[];
  try{
    const child=await launch(script,run);children.push(child);
    const pids=await Promise.all(['root','child','grandchild','browser'].map(role=>pid(run,role)));
    const identity=await captureTaskProcess(child.pid!,run);
    assert.ok(identity);
    await terminateTaskProcess(identity!);
    const rows=await listProcesses();
    for(const processId of pids)assert.equal(rows.some(row=>row.pid===processId),false,`process ${processId} survived cancellation`);
  }finally{await cleanup(children,directory);}
});

test('orphan recovery kills only this run marker and refuses a reused saved PID',async()=>{
  const {directory,script}=await fixture();const run=path.join(directory,'runs','task-1');const other=path.join(directory,'runs','task-10');const children:ChildProcess[]=[];
  try{
    const reused=await launch(script,run,'unrelated');children.push(reused);
    const separate=await launch(script,other);children.push(separate);
    const otherPids=await Promise.all(['root','child','grandchild','browser'].map(role=>pid(other,role)));
    const ownedBrowser=spawn(process.execPath,[script,run,'orphan','--moyo-task='+run],{detached:true,windowsHide:true,stdio:'ignore'});children.push(ownedBrowser);
    ownedBrowser.unref();
    const orphanPid=await pid(run,'orphan');
    const identity=await captureTaskProcess(reused.pid!,run);assert.ok(identity);
    await recoverTaskProcesses(run,{...identity!,startedAt:'a different process creation time'});
    const rows=await listProcesses();
    assert.equal(rows.some(row=>row.pid===orphanPid),false);
    assert.ok(rows.some(row=>row.pid===reused.pid),'reused PID was killed');
    for(const processId of otherPids)assert.ok(rows.some(row=>row.pid===processId),`other task process ${processId} was killed`);
  }finally{await cleanup(children,directory);}
});

test('worker persists ownership and writes cancelled only after its actual child tree exits',async()=>{
  const {directory,script}=await fixture();const data=path.join(directory,'data');const run=path.join(data,'runs','worker-cancel');
  let worker:ChildProcess|undefined;
  try{
    const python=pythonCommand();const scripts=path.join(directory,'scripts');await fs.mkdir(scripts);
    await fs.mkdir(path.join(data,'jobs'),{recursive:true});await fs.mkdir(run,{recursive:true});
    await fs.writeFile(path.join(scripts,'build_voice.py'),`
import argparse, os, pathlib, subprocess, time
parser = argparse.ArgumentParser()
parser.add_argument('--input'); parser.add_argument('--output'); parser.add_argument('--cache')
args = parser.parse_args()
pathlib.Path(args.output, 'voice.pid').write_text(str(os.getpid()), encoding='utf-8')
subprocess.Popen([${JSON.stringify(process.execPath)}, ${JSON.stringify(script)}, args.output, 'root'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print('{"progress":0.1,"message":"fixture started"}', flush=True)
while True: time.sleep(1)
`);
    const project=blankProject();const now=new Date().toISOString();const jobFile=path.join(data,'jobs','worker-cancel.json');
    await fs.writeFile(path.join(run,'project.json'),JSON.stringify(project));
    await fs.writeFile(jobFile,JSON.stringify({id:'worker-cancel',projectId:project.id,revision:1,kind:'prepare',status:'queued',stage:'queued',progress:0,message:'queued',createdAt:now,updatedAt:now,audioKey:audioKey(project),projectKey:projectKey(project)}));
    worker=spawn(process.execPath,['--import','tsx',path.resolve('scripts/worker.ts')],{cwd:path.resolve('.'),windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,MOYO_ROOT:directory,MOYO_DATA_DIR:data,MOYO_PYTHON:python.executable}});
    let stderr='';worker.stderr!.on('data',data=>{stderr+=data;});
    const pids=await Promise.all(['voice','root','child','grandchild','browser'].map(role=>pid(run,role)));
    const running=await waitFor(async()=>{const job=JSON.parse(await fs.readFile(jobFile,'utf8'));return job.childProcess?job:undefined;});
    // Windows py.exe owns the interpreter process as a child; persist the launcher identity.
    assert.equal(running.childProcess.pid,running.childPgid);assert.equal(running.childProcess.runDirectory,run);pids.push(running.childProcess.pid);
    await fs.writeFile(path.join(run,'cancel.json'),'{}');
    const terminal=await waitFor(async()=>{const job=JSON.parse(await fs.readFile(jobFile,'utf8'));return job.status==='cancelled'?job:undefined;},30_000);
    assert.equal(terminal.childProcess,undefined);assert.equal(terminal.childPgid,undefined);
    const rows=await listProcesses();for(const processId of pids)assert.equal(rows.some(row=>row.pid===processId),false,`worker reported cancelled while ${processId} was alive`);
    await waitFor(async()=>worker!.exitCode!==null||worker!.signalCode!==null,10_000);
    assert.equal(worker.exitCode,0,stderr);
  }finally{
    if(worker?.pid&&worker.exitCode===null&&worker.signalCode===null)worker.kill();
    await cleanup([],directory);
  }
});
