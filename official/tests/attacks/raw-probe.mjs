import fs from 'node:fs';
import net from 'node:net';
import {spawn} from 'node:child_process';
const out={};
for(const [key,path] of [['home','/home'],['root','/root'],['ssh','/root/.ssh']]){try{fs.readdirSync(path);out[key]='readable';}catch{out[key]='blocked';}}
try{fs.writeFileSync('/arena/escape','x');out.write='succeeded';}catch{out.write='blocked';}
try{fs.writeFileSync('/tmp/allowed','x');out.tmp='writable';}catch{out.tmp='blocked';}
try{fs.writeFileSync('/dev/escape','x');out.dev='succeeded';}catch{out.dev='blocked';}
try{fs.writeFileSync('/tmp/large',Buffer.alloc(2*1024*1024));out.fsize='succeeded';}catch{out.fsize='blocked';}
out.env=process.env.ARENA_HOST_SECRET??'blocked';
try{Buffer.allocUnsafe(3*1024**3);out.memory='succeeded';}catch{out.memory='blocked';}
out.network=await new Promise(resolve=>{const socket=net.connect(41388,'127.0.0.1');socket.on('connect',()=>{socket.destroy();resolve('connected')});socket.on('error',()=>resolve('blocked'));socket.setTimeout(1000,()=>{socket.destroy();resolve('blocked')});});
out.heap=await new Promise((resolve,reject)=>{
 const child=spawn('/arena/node',['--max-old-space-size=128','-e','const a=[];for(;;)a.push(new Array(100000).fill(Math.random()))'],{stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,limited:/heap out of memory|allocation failed/i.test(stderr)}));
});
const children=[];let successes=0;const errors=[];
for(let i=0;i<64;i++){
 const child=spawn('/arena/node',['-e','setTimeout(()=>{},3000)'],{stdio:'ignore'});children.push(child);
 await new Promise(resolve=>{child.once('spawn',()=>{successes++;resolve();});child.once('error',e=>{errors.push(e.code);resolve();});});
}
for(const c of children)c.kill('SIGKILL');
out.fork={successes,errors};
console.log(JSON.stringify(out));
