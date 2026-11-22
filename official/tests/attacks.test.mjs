import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createIsolatedBot} from '../loader.mjs';
const point={x:0,y:0,z:0,heading:0,pitch:0,bank:0};
const view={traffic:[],track:{id:'study',length:1,halfWidth:6,point:()=>point}};
process.env.ARENA_HOST_SECRET='unique-host-secret-for-arena-check';
for(const name of ['read','env','network','fork','write','loop','memory']) test(name,{timeout:15000},async()=>{
 let server,connected=false;
 if(name==='network') {server=net.createServer(s=>{connected=true;s.destroy()});await new Promise((resolve,reject)=>server.once('error',reject).listen(41387,'127.0.0.1',resolve));}
 let bot;try{
  bot=await createIsolatedBot(`official/tests/attacks/${name}.ts`,7);
  const start=performance.now(),result=bot.tick(view),elapsed=performance.now()-start;
  assert.deepEqual(result,{throttle:0,brake:0,steer:0});
  assert.ok(elapsed<1000,`tick blocked for ${elapsed} ms`);
  if(name==='memory')assert.equal(bot.id,'memory-cap-blocked','allocation unexpectedly succeeded');
  if(name==='loop')assert.ok(bot.timeoutCount+bot.errorCount>0,'expected a timeout or child failure');
  if(name==='loop')assert.equal(bot.timeoutCount,1);
  if(server){await new Promise(r=>setTimeout(r,100));assert.equal(connected,false,'host loopback was reached');}
 }finally{await bot?.close();if(server)await new Promise(r=>server.close(r));}
});
