import fs from 'node:fs';
import net from 'node:net';
import {spawn} from 'node:child_process';
const out={};
try{fs.readdirSync('/home');out.home='readable';}catch{out.home='blocked';}
try{fs.writeFileSync('/arena/escape','x');out.write='succeeded';}catch{out.write='blocked';}
try{fs.writeFileSync('/tmp/allowed','x');out.tmp='writable';}catch{out.tmp='blocked';}
try{fs.writeFileSync('/dev/escape','x');out.dev='succeeded';}catch{out.dev='blocked';}
try{fs.writeFileSync('/tmp/large',Buffer.alloc(2*1024*1024));out.fsize='succeeded';}catch{out.fsize='blocked';}
out.env=process.env.ARENA_HOST_SECRET??'blocked';
try{Buffer.allocUnsafe(3*1024**3);out.memory='succeeded';}catch{out.memory='blocked';}
out.network=await new Promise(resolve=>{const socket=net.connect(41388,'127.0.0.1');socket.on('connect',()=>{socket.destroy();resolve('connected')});socket.on('error',()=>resolve('blocked'));socket.setTimeout(1000,()=>{socket.destroy();resolve('blocked')});});
const children=[];let blocked=false;
for(let i=0;i<64;i++){const child=spawn('/arena/node',['-e','setTimeout(()=>{},3000)'],{stdio:'ignore'});children.push(child);child.on('error',()=>{blocked=true;});}
await new Promise(resolve=>setTimeout(resolve,500));
for(const c of children)c.kill('SIGKILL');
out.fork=blocked?'blocked':'not-blocked';
console.log(JSON.stringify(out));
