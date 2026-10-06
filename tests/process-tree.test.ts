import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { captureTaskProcess, listProcesses, recoverTaskProcesses, terminateTaskProcess, type ProcessInfo } from '../src/server/process-tree';
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
function sameProcess(expected:ProcessInfo,actual:ProcessInfo){return expected.pid===actual.pid&&expected.startedAt===actual.startedAt;}
function normalized(value:string){const result=value.replace(/\\/g,'/');return process.platform==='win32'?result.toLowerCase():result;}
function escaped(value:string){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function taskProcesses(rows:ProcessInfo[],run:string,scripts:string[]){
  const directory=escaped(normalized(run));
  const argument=new RegExp(`(?:^|[\\s"'=])${directory}(?=$|[\\s"'])`);
  const marker=new RegExp(`(?:^|[\\s"'])--moyo-task=${directory}(?=$|[\\s"'])`);
  return rows.filter(row=>{const command=normalized(row.command);return marker.test(command)||(argument.test(command)&&scripts.some(script=>command.includes(normalized(script))));});
}
async function captureFixtures(pids:number[],run:string,scripts:string[]){
  const rows=await listProcesses();const owned=taskProcesses(rows,run,scripts);
  return [...new Set(pids)].map(processId=>{
    const row=owned.find(row=>row.pid===processId);
    assert.ok(row,`fixture ${processId} is missing before termination; observed ${JSON.stringify(rows.find(row=>row.pid===processId))}`);
    return row;
  });
}
function assertExited(expected:ProcessInfo[],rows:ProcessInfo[],run:string,scripts:string[],allowed:ProcessInfo[]=[]){
  for(const original of expected){
    const samePid=rows.find(row=>row.pid===original.pid);
    assert.ok(!samePid||!sameProcess(original,samePid),`fixture survived termination: ${JSON.stringify({expected:original,observed:samePid})}`);
  }
  const leftovers=taskProcesses(rows,run,scripts).filter(row=>!allowed.some(original=>sameProcess(original,row)));
  assert.deepEqual(leftovers,[],`task marker or fixture command survived termination: ${JSON.stringify({expected,leftovers})}`);
}
function assertAlive(expected:ProcessInfo[],rows:ProcessInfo[]){
  for(const original of expected){
    const samePid=rows.find(row=>row.pid===original.pid);
    assert.ok(samePid&&sameProcess(original,samePid),`protected process was terminated or replaced: ${JSON.stringify({expected:original,observed:samePid})}`);
  }
}
async function cleanup(children:ChildProcess[],directory:string){
  // Fixture cleanup is independent of the implementation under test, including red runs.
  for(const row of await listProcesses()){
    if(!row.command.includes(path.join(directory,'process.cjs'))&&!row.command.includes(path.join(directory,'scripts','build_voice.py')))continue;
    try{
      // Recheck creation time immediately before a native kill during red-run cleanup.
      if(!(await listProcesses()).some(current=>sameProcess(row,current)))continue;
      if(process.platform==='win32')execFileSync(path.join(process.env.SystemRoot!,'System32','taskkill.exe'),['/PID',String(row.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      else process.kill(row.pid,'SIGKILL');
    }catch{}
  }
  await fs.rm(directory,{recursive:true,force:true});
}

test('termination assertions distinguish reused PIDs and still reject actual task leftovers',()=>{
  const run=path.join(os.tmpdir(),'moyo process 中文 assertion','runs','task-1');
  const script=path.join(path.dirname(path.dirname(run)),'process.cjs');
  const original:ProcessInfo={pid:7544,parentPid:1,startedAt:'2026-10-06T06:52:00.000Z',command:`node "${script}" "${run}" root`};
  const recycled={...original,startedAt:'2026-10-06T06:52:23.000Z',command:'unrelated chromium process'};
  assert.doesNotThrow(()=>assertExited([original],[recycled],run,[script]));
  assert.throws(()=>assertExited([original],[original],run,[script]),/fixture survived termination/);
  assert.throws(()=>assertExited([original],[{...recycled,command:original.command}],run,[script]),/task marker or fixture command survived termination/);
  assert.throws(()=>assertExited([original],[{...recycled,pid:9999,command:`chromium "--moyo-task=${run}"`}],run,[script]),/task marker or fixture command survived termination/);
  assert.throws(()=>assertAlive([original],[recycled]),/protected process was terminated or replaced/);
});

test('cancelling a real task waits for children, grandchildren and a detached browser to exit',async()=>{
  const {directory,script}=await fixture();const run=path.join(directory,'runs','task-1');const children:ChildProcess[]=[];
  try{
    const child=await launch(script,run);children.push(child);
    const pids=await Promise.all(['root','child','grandchild','browser'].map(role=>pid(run,role)));
    const originals=await captureFixtures(pids,run,[script]);
    const identity=await captureTaskProcess(child.pid!,run);
    assert.ok(identity);
    await terminateTaskProcess(identity!);
    const rows=await listProcesses();
    assertExited(originals,rows,run,[script]);
  }finally{await cleanup(children,directory);}
});

test('orphan recovery kills only this run marker and refuses a reused saved PID',async()=>{
  const {directory,script}=await fixture();const run=path.join(directory,'runs','task-1');const other=path.join(directory,'runs','task-10');const children:ChildProcess[]=[];
  try{
    const reused=await launch(script,run,'unrelated');children.push(reused);
    const separate=await launch(script,other);children.push(separate);
    const otherPids=await Promise.all(['root','child','grandchild','browser'].map(role=>pid(other,role)));
    const otherOriginals=await captureFixtures(otherPids,other,[script]);
    const ownedBrowser=spawn(process.execPath,[script,run,'orphan','--moyo-task='+run],{detached:true,windowsHide:true,stdio:'ignore'});children.push(ownedBrowser);
    ownedBrowser.unref();
    const orphanPid=await pid(run,'orphan');
    const [protectedOriginal,orphanOriginal]=await captureFixtures([reused.pid!,orphanPid],run,[script]);
    const identity=await captureTaskProcess(reused.pid!,run);assert.ok(identity);
    await recoverTaskProcesses(run,{...identity!,startedAt:'a different process creation time'});
    const rows=await listProcesses();
    assertExited([orphanOriginal],rows,run,[script],[protectedOriginal]);
    assertAlive([protectedOriginal,...otherOriginals],rows);
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
    const fixtureScripts=[script,path.join(scripts,'build_voice.py')];
    const originals=await captureFixtures(pids,run,fixtureScripts);
    assert.equal(originals.find(row=>row.pid===running.childProcess.pid)?.startedAt,running.childProcess.startedAt);
    await fs.writeFile(path.join(run,'cancel.json'),'{}');
    const terminal=await waitFor(async()=>{const job=JSON.parse(await fs.readFile(jobFile,'utf8'));return job.status==='cancelled'?job:undefined;},30_000);
    assert.equal(terminal.childProcess,undefined);assert.equal(terminal.childPgid,undefined);
    const rows=await listProcesses();assertExited(originals,rows,run,fixtureScripts);
    await waitFor(async()=>worker!.exitCode!==null||worker!.signalCode!==null,10_000);
    assert.equal(worker.exitCode,0,stderr);
  }finally{
    if(worker?.pid&&worker.exitCode===null&&worker.signalCode===null)worker.kill();
    await cleanup([],directory);
  }
});
