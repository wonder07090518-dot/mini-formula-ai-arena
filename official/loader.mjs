import fs from 'node:fs/promises';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {accessSync,constants} from 'node:fs';
import ts from 'typescript';
const here=path.dirname(fileURLToPath(import.meta.url));
const ZERO=Object.freeze({throttle:0,brake:0,steer:0});
export const FRAME_BUDGET_MS=20;
export async function createIsolatedBot(file,seed){
 const temporaryRoot=path.resolve(here,'../tmp');await fs.mkdir(temporaryRoot,{recursive:true});
 const dir=await fs.mkdtemp(path.join(temporaryRoot,'arena-bot-'));
 const bootstrap=path.join(dir,'child.mjs'),bot=path.join(dir,'bot.mjs');
 try{
  const source=await fs.readFile(file,'utf8');
  await fs.copyFile(path.join(here,'child.mjs'),bootstrap);
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  await fs.writeFile(bot,compiled);
  try{accessSync('/usr/bin/bwrap',constants.X_OK);}catch{throw new Error('bubblewrap (bwrap) is required to isolate arena bots');}
  const shared=new SharedArrayBuffer(65536),state=new Int32Array(shared,0,4),bytes=new Uint8Array(shared,16);
  const worker=new Worker(path.join(here,'broker.mjs'),{execArgv:[],workerData:{shared,bootstrap,bot,seed,bwrap:true}});
  let id=path.basename(file),startupError;
  await new Promise(resolve=>{const timer=setTimeout(()=>{startupError='Child startup timed out';resolve();},5000);worker.on('message',msg=>{if(msg.kind==='ready'){id=msg.id;clearTimeout(timer);resolve();}else if(msg.kind==='startup-error'){startupError=msg.error;clearTimeout(timer);resolve();}});worker.on('error',err=>{startupError=String(err);clearTimeout(timer);resolve();});});
  if(startupError){await new Promise(resolve=>{const timer=setTimeout(()=>worker.terminate().finally(resolve),1000);worker.once('exit',()=>{clearTimeout(timer);resolve();});worker.postMessage({kind:'close'});});throw Error(startupError);}
  let sequence=0,table;const adapter={get id(){return id;},timeoutCount:0,errorCount:0,lastError:startupError,
   tick(view){
    if(!table){table=Array.from({length:2048},(_,i)=>({...view.track.point(i/2048)}));}
    const {track,...rest}=view;const snapshot={...rest,track:{id:track.id,length:track.length,halfWidth:track.halfWidth}};
    const seq=++sequence;Atomics.store(state,0,seq);const started=performance.now();
    try{worker.postMessage({kind:'tick',seq,view:snapshot,table:seq===1?table:undefined});}catch(error){adapter.errorCount++;adapter.lastError=String(error);return ZERO;}
    while(Atomics.load(state,3)!==seq){
     const remaining=FRAME_BUDGET_MS-(performance.now()-started);
     if(remaining<=0){adapter.timeoutCount++;worker.postMessage({kind:'cancel',seq});return ZERO;}
     const observed=Atomics.load(state,3);if(observed!==seq)Atomics.wait(state,3,observed,remaining);
    }
    try{const result=JSON.parse(Buffer.from(bytes.subarray(0,Atomics.load(state,2))).toString());if(result.kind==='result')return result.controls;adapter.errorCount++;adapter.lastError=result.error;return ZERO;}
    catch(error){adapter.errorCount++;adapter.lastError=String(error);return ZERO;}
   },
   async close(){await new Promise(resolve=>{const timer=setTimeout(()=>{worker.terminate().finally(resolve);},1000);worker.once('exit',()=>{clearTimeout(timer);resolve();});worker.postMessage({kind:'close'});});await fs.rm(dir,{recursive:true,force:true});}
  };
  return adapter;
 }catch(error){await fs.rm(dir,{recursive:true,force:true});throw error;}
}
