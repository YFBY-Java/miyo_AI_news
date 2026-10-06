import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute=promisify(execFile);
const pause=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const systemExecutable=(name:string)=>path.join(process.env.SystemRoot||process.env.WINDIR||'C:\\Windows','System32',name);
export interface TaskProcessIdentity { pid:number; startedAt:string; runDirectory:string }
export interface ProcessInfo { pid:number; parentPid:number; groupId?:number; startedAt:string; command:string }

// Creation time is part of the identity: a saved PID alone may now belong to another app.
export async function listProcesses():Promise<ProcessInfo[]> {
  if(process.platform==='win32'){
    const script="[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate } | ForEach-Object { @{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;startedAt=$_.CreationDate.ToUniversalTime().ToString('o');command=[string]$_.CommandLine} }) | ConvertTo-Json -Compress";
    const {stdout}=await execute(path.join(path.dirname(systemExecutable('taskkill.exe')),'WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',timeout:15_000,maxBuffer:16_000_000});
    const parsed=JSON.parse(stdout.trim()||'[]');
    return (Array.isArray(parsed)?parsed:[parsed]).filter(row=>Number.isInteger(row.pid)&&row.pid>0&&row.startedAt);
  }
  // Keep dates parseable without making macOS ps escape Chinese command paths.
  const {stdout}=await execute('ps',['-ww','-axo','pid=,ppid=,pgid=,lstart=,stat=,command='],{windowsHide:true,encoding:'utf8',env:{...process.env,LC_ALL:'',LC_TIME:'C',LC_CTYPE:'en_US.UTF-8'},timeout:10_000,maxBuffer:16_000_000});
  return stdout.split('\n').flatMap(line=>{
    const match=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.*)$/.exec(line);
    if(!match||match[5].startsWith('Z'))return [];
    return [{pid:Number(match[1]),parentPid:Number(match[2]),groupId:Number(match[3]),startedAt:match[4].replace(/\s+/g,' '),command:match[6]}];
  });
}
function normalized(value:string){const result=value.replace(/\\/g,'/');return process.platform==='win32'?result.toLowerCase():result;}
function escaped(value:string){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function ownsRun(processInfo:ProcessInfo,runDirectory:string,markerOnly=false){
  const command=normalized(processInfo.command);const directory=escaped(normalized(path.resolve(runDirectory)));
  return new RegExp(`(?:^|[\\s"'=])${markerOnly?'--moyo-task=':''}${directory}(?=$|[\\s"'])`).test(command);
}
function sameProcess(row:ProcessInfo,identity:TaskProcessIdentity){return row.pid===identity.pid&&row.startedAt===identity.startedAt;}
export async function captureTaskProcess(pid:number,runDirectory:string):Promise<TaskProcessIdentity|undefined>{
  const row=(await listProcesses()).find(row=>row.pid===pid&&ownsRun(row,runDirectory));
  return row?{pid,startedAt:row.startedAt,runDirectory:path.resolve(runDirectory)}:undefined;
}

function ownedProcesses(rows:ProcessInfo[],runDirectory:string,identity?:TaskProcessIdentity,legacyPid?:number){
  const owned=new Map<number,ProcessInfo>();
  const root=rows.find(row=>identity
    ?normalized(path.resolve(identity.runDirectory))===normalized(path.resolve(runDirectory))&&sameProcess(row,identity)&&ownsRun(row,runDirectory)
    :row.pid===legacyPid&&ownsRun(row,runDirectory));
  if(root)owned.set(root.pid,root);
  for(const row of rows)if(ownsRun(row,runDirectory,true))owned.set(row.pid,row);
  let added=true;
  while(added){
    added=false;
    for(const row of rows){
      if(owned.has(row.pid))continue;
      const parent=owned.get(row.parentPid);
      // ParentProcessId is not updated on Windows if a parent exits and its PID is reused.
      const bornAfterParent=parent&&Date.parse(row.startedAt)>=Date.parse(parent.startedAt);
      const leader=row.groupId&&owned.get(row.groupId);
      if(bornAfterParent||(leader&&leader.pid===leader.groupId&&Date.parse(row.startedAt)>=Date.parse(leader.startedAt))){owned.set(row.pid,row);added=true;}
    }
  }
  return owned;
}
async function signalProcesses(known:Map<number,ProcessInfo>,signal:'SIGTERM'|'SIGKILL'){
  const rows=await listProcesses();let current=new Map(rows.map(row=>[row.pid,row]));
  const groups=new Set<number>();
  for(const expected of known.values()){
    if(process.platform==='win32')current=new Map((await listProcesses()).map(row=>[row.pid,row]));
    const row=current.get(expected.pid);if(!row||row.startedAt!==expected.startedAt)continue;
    if(process.platform==='win32'){
      try{await execute(systemExecutable('taskkill.exe'),['/PID',String(row.pid),'/T','/F'],{windowsHide:true,encoding:'utf8',timeout:15_000});}
      catch(error){
        // taskkill may race another taskkill call or a process exiting naturally.
        if((await listProcesses()).some(item=>sameProcess(item,{...expected,runDirectory:''})))throw error;
      }
    }else{
      try{
        if(row.groupId===row.pid&&!groups.has(row.pid)){process.kill(-row.pid,signal);groups.add(row.pid);}
        else if(!row.groupId||!groups.has(row.groupId))process.kill(row.pid,signal);
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
    }
  }
}
async function terminate(runDirectory:string,identity?:TaskProcessIdentity,legacyPid?:number){
  const known=ownedProcesses(await listProcesses(),runDirectory,identity,legacyPid);
  if(!known.size)return;
  await signalProcesses(known,'SIGTERM');
  const gracefulDeadline=Date.now()+(process.platform==='win32'?0:2500);
  const finalDeadline=Date.now()+8000;
  let forced=process.platform==='win32';
  while(true){
    const rows=await listProcesses();
    for(const row of ownedProcesses(rows,runDirectory,identity).values())known.set(row.pid,row);
    const survivors=new Map([...known].filter(([pid,expected])=>rows.some(row=>row.pid===pid&&row.startedAt===expected.startedAt)));
    if(!survivors.size)return;
    if(forced)await signalProcesses(survivors,'SIGKILL');
    if(!forced&&Date.now()>=gracefulDeadline){await signalProcesses(survivors,'SIGKILL');forced=true;}
    if(Date.now()>=finalDeadline)throw new Error('任务子进程未退出，暂不能确认取消完成');
    await pause(200);
  }
}
const stopping=new Map<string,Promise<void>>();
export function terminateTaskProcess(identity:TaskProcessIdentity){
  const key=`${identity.pid}:${identity.startedAt}:${identity.runDirectory}`;
  const existing=stopping.get(key);if(existing)return existing;
  const pending=terminate(identity.runDirectory,identity).finally(()=>stopping.delete(key));
  stopping.set(key,pending);return pending;
}
export async function recoverTaskProcesses(runDirectory:string,identity?:TaskProcessIdentity,legacyPid?:number){
  await terminate(runDirectory,identity,legacyPid);
}
