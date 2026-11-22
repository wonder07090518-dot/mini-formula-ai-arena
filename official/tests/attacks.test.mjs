import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import {createIsolatedBot} from '../loader.mjs';
const point={x:0,y:0,z:0,heading:0,pitch:0,bank:0};
const view={traffic:[],track:{id:'study',length:1,halfWidth:6,point:()=>point}};
process.env.ARENA_HOST_SECRET='unique-host-secret-for-arena-check';
for(const name of ['read','env','network','fork','write','loop','memory']) test(name,{timeout:15000},async()=>{
 let server,connected=false;
 if(name==='network') {server=net.createServer(s=>{connected=true;s.destroy()});await new Promise((resolve,reject)=>server.once('error',reject).listen(41387,'127.0.0.1',resolve));}
 let bot,staged;const before=new Set(await fs.readdir('tmp').catch(()=>[]));try{
  bot=await createIsolatedBot(`official/tests/attacks/${name}.ts`,7);
  staged=(await fs.readdir('tmp')).find(x=>x.startsWith('arena-bot-')&&!before.has(x));
  const start=performance.now(),result=bot.tick(view),elapsed=performance.now()-start;
  assert.deepEqual(result,{throttle:0,brake:0,steer:0});
  assert.ok(elapsed<1000,`tick blocked for ${elapsed} ms`);
  if(['read','network','fork','write'].includes(name)){assert.equal(bot.errorCount,1);assert.match(bot.lastError,/Denied module/);}
  if(name==='memory')assert.equal(bot.id,'memory-cap-blocked','allocation unexpectedly succeeded');
  if(name==='loop')assert.ok(bot.timeoutCount+bot.errorCount>0,'expected a timeout or child failure');
  if(name==='loop')assert.equal(bot.timeoutCount,1);
  if(server){await new Promise(r=>setTimeout(r,100));assert.equal(connected,false,'host loopback was reached');}
 }finally{await bot?.close();if(name==='loop'&&staged)await assertReaped(staged);if(server)await new Promise(r=>server.close(r));}
});

async function assertReaped(staged){
 for(let attempt=0;attempt<100;attempt++){
  const pids=(await fs.readdir('/proc')).filter(x=>/^\d+$/.test(x));
  const matches=(await Promise.all(pids.map(async pid=>{try{return (await fs.readFile(`/proc/${pid}/cmdline`)).toString().includes(staged);}catch{return false;}}))).filter(Boolean);
  if(matches.length===0)return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.fail(`sandbox processes remain for ${staged}`);
}
test('forged results are rejected without aborting subsequent ticks',{timeout:15000},async()=>{
 const before=new Set(await fs.readdir('tmp').catch(()=>[]));
 const bot=await createIsolatedBot('official/tests/attacks/forge.ts',7);
 const staged=(await fs.readdir('tmp')).find(x=>x.startsWith('arena-bot-')&&!before.has(x));
 try{for(let i=1;i<=3;i++){assert.deepEqual(bot.tick(view),{throttle:0,brake:0,steer:0});assert.equal(bot.errorCount,i);assert.match(bot.lastError,/Invalid controls/);}}
 finally{await bot.close();if(staged)await assertReaped(staged);}
});
test('heap exhaustion during tick fails closed',{timeout:15000},async()=>{
 const bot=await createIsolatedBot('official/tests/attacks/heap.ts',7);
 try{assert.deepEqual(bot.tick(view),{throttle:0,brake:0,steer:0});assert.ok(bot.errorCount+bot.timeoutCount>0);}
 finally{await bot.close();}
});
