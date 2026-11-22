import {parentPort,workerData} from 'node:worker_threads';
import {spawn} from 'node:child_process';
import {sandboxArgs} from './sandbox.mjs';
const state=new Int32Array(workerData.shared,0,4),bytes=new Uint8Array(workerData.shared,16);
let child,ready=false,tableNeeded=true,pending=null,generation=0,table,queued,startupFailure;
function answer(seq,obj){if(Atomics.load(state,0)!==seq)return;const data=Buffer.from(JSON.stringify(obj));if(data.length>bytes.length)return;bytes.set(data);Atomics.store(state,2,data.length);Atomics.store(state,3,seq);Atomics.notify(state,3);}
function launch(){
 const gen=++generation;ready=false;tableNeeded=true;startupFailure=undefined;
 const node=process.execPath,bootstrap=workerData.bootstrap,bot=workerData.bot;
 const args=sandboxArgs({node,bootstrap,bot,seed:workerData.seed});
 child=spawn('/usr/bin/bwrap',args,{stdio:['pipe','pipe','pipe'],env:{}});
 child.stderr.on('data',()=>{});
 let buffer='';child.stdout.on('data',data=>{buffer+=data;if(buffer.length>1048576){child.kill('SIGKILL');return;}let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let msg;try{msg=JSON.parse(line);}catch{continue;}if(gen!==generation)continue;
  if(msg.kind==='ready'){ready=true;parentPort.postMessage({kind:'ready',id:msg.id});if(queued){const q=queued;queued=null;sendTick(q);}}
  else if(msg.kind==='startup-error'){startupFailure=msg.error;parentPort.postMessage({kind:'startup-error',error:msg.error});if(pending){answer(pending,{kind:'error',error:msg.error});pending=null;}}
  else if((msg.kind==='result'||msg.kind==='error')&&msg.seq===pending){answer(msg.seq,msg);pending=null;}
 }});
 child.on('error',err=>{if(gen===generation){startupFailure=String(err);parentPort.postMessage({kind:'startup-error',error:String(err)});if(pending){answer(pending,{kind:'error',error:String(err)});pending=null;}}});
 child.on('exit',()=>{if(gen===generation){const wasReady=ready;ready=false;if(pending){answer(pending,{kind:'error',error:'Child exited'});pending=null;queued=null;}if(wasReady){launch();}else{startupFailure=startupFailure??'Child exited';parentPort.postMessage({kind:'startup-error',error:startupFailure});}}});
}
launch();
function sendTick(msg){pending=msg.seq;child.stdin.write(JSON.stringify({kind:'tick',seq:msg.seq,view:msg.view,table:tableNeeded?table:undefined})+'\n',err=>{if(err&&pending===msg.seq){answer(msg.seq,{kind:'error',error:String(err)});pending=null;}});tableNeeded=false;}
parentPort.on('message',msg=>{
 if(msg.kind==='close'){generation++;child?.kill('SIGKILL');parentPort.postMessage({kind:'closed'});process.exit(0);}
 if(msg.kind==='cancel'){if(msg.seq===pending){const booting=queued!==null&&queued!==undefined;pending=null;queued=null;if(!booting){generation++;child?.kill('SIGKILL');launch();}}return;}
 if(msg.kind!=='tick')return;
 if(msg.table)table=msg.table;
 if(startupFailure){answer(msg.seq,{kind:'error',error:startupFailure});return;}
 if(!ready){pending=msg.seq;queued=msg;return;}
 sendTick(msg);
});
