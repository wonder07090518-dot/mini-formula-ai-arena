import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
const send = value => process.stdout.write(JSON.stringify(value)+'\n');
const denied=new Set(['fs','fs/promises','net','dgram','dns','dns/promises','http','http2','https','tls','child_process','worker_threads','module']);
registerHooks({resolve(specifier,context,next){
 const name=specifier.replace(/^node:/,'');
 if(denied.has(name))throw new Error(`Denied module: ${name}`);
 return next(specifier,context);
}});
const getBuiltinModule=process.getBuiltinModule.bind(process);
process.getBuiltinModule=name=>{if(denied.has(String(name).replace(/^node:/,'')))throw Error(`Denied module: ${name}`);return getBuiltinModule(name);};
globalThis.fetch=()=>{throw new Error('Network access denied');};
let bot;
try{
 const module=await import(pathToFileURL(process.argv[2]).href);
 bot=typeof module.createBot==='function'?module.createBot(Number(process.argv[3])):new module.default(Number(process.argv[3]));
 if(!bot||typeof bot.id!=='string'||!bot.id.trim()||bot.id.length>100||typeof bot.tick!=='function')throw Error('Bot must have a nonempty stable id and tick method');
 send({kind:'ready',id:bot.id});
}catch(error){send({kind:'startup-error',error:String(error)});}
const wrap=t=>((t%1)+1)%1;
function sampler(track,table){
 const point=t=>{const n=table.length,u=wrap(t)*n,i=Math.floor(u),f=u-i,a=table[i],b=table[(i+1)%n],out={};
  for(const k of ['x','y','z','pitch','bank'])if(a[k]!==undefined&&b[k]!==undefined)out[k]=a[k]+(b[k]-a[k])*f;
  out.heading=a.heading+Math.atan2(Math.sin(b.heading-a.heading),Math.cos(b.heading-a.heading))*f;return Object.freeze(out);};
 const nearest=(x,z,y)=>{let best=Infinity,at=0;
  for(let i=0;i<table.length;i++){const a=table[i],b=table[(i+1)%table.length],dx=b.x-a.x,dz=b.z-a.z,dy=(b.y??0)-(a.y??0),q=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz+(y===undefined?0:(y-(a.y??0))*dy))/(dx*dx+dz*dz+(y===undefined?0:dy*dy)||1))),px=a.x+dx*q,pz=a.z+dz*q,py=(a.y??0)+dy*q,d=(x-px)**2+(z-pz)**2+(y===undefined?0:(y-py)**2);if(d<best){best=d;at=(i+q)/table.length;}}
  const p=point(at),dx=x-p.x,dz=z-p.z;return Object.freeze({...p,t:wrap(at),distance:Math.hypot(dx,dz),signedDistance:dx*Math.cos(p.heading)-dz*Math.sin(p.heading)});};
 return Object.freeze({...track,point,nearest});
}
let track;
createInterface({input:process.stdin}).on('line',line=>{ let msg; try {msg=JSON.parse(line)} catch {return;} if(msg.kind!=='tick'||!bot)return;try{
 if(msg.table)track=sampler(msg.view.track,msg.table);
 const view=Object.freeze({...msg.view,traffic:Object.freeze(msg.view.traffic.map(Object.freeze)),track});
 const result=bot.tick(view);if(!result||typeof result!=='object'||['throttle','brake','steer'].some(k=>typeof result[k]!=='number'))throw Error('tick must return numeric controls');
 send({kind:'result',seq:msg.seq,controls:{throttle:result.throttle,brake:result.brake,steer:result.steer}});
 }catch(error){send({kind:'error',seq:msg.seq,error:String(error)});}});
