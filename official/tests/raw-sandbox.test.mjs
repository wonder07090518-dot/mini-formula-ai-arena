import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import {sandboxArgs} from '../sandbox.mjs';
test('kernel isolation and resource limits without Node permissions', {timeout:15000}, async()=>{
 let connected=false;const server=net.createServer(s=>{connected=true;s.destroy()});await new Promise((resolve,reject)=>server.once('error',reject).listen(41388,'127.0.0.1',resolve));
 try{
  const args=sandboxArgs({node:process.execPath,bootstrap:path.resolve('official/child.mjs'),bot:path.resolve('official/tests/attacks/raw-probe.mjs'),probe:true});
  const child=spawn('/usr/bin/bwrap',args,{env:{...process.env,ARENA_HOST_SECRET:'raw-probe-secret'}});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});
  assert.equal(code,0,stderr);const result=JSON.parse(stdout);for(const key of ['home','write','env','memory','network','fork','dev','fsize'])assert.equal(result[key],'blocked',`${key}: ${JSON.stringify(result)}`);assert.equal(result.tmp,'writable');assert.equal(connected,false);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
