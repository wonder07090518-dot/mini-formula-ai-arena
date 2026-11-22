import * as THREE from 'three';
import {Opponents} from './engine/opponents.ts';
import {createBarrierSurface} from './engine/kerb-surface.ts';
import {nearestTrack,trackHalfWidthAt,startingGridSlot} from './engine/track-layout.ts';
import {createIsolatedBot} from '../official/loader.mjs';
import {arenaGridSlots} from './grid.mjs';
import {penalizedTime} from './score.mjs';
const argv=process.argv.slice(2);if(argv.length%2)throw Error('Arguments must be flag/value pairs');
const args=Object.fromEntries(Array.from({length:argv.length/2},(_,i)=>[argv[i*2],argv[i*2+1]]));
const allowed=['--bot','--grid','--track','--seed','--laps','--weather','--max-ticks'];
if(Object.keys(args).some(k=>!allowed.includes(k)))throw Error('Unknown argument');
const track=args['--track']??'study',seed=Number(args['--seed']??7),laps=Number(args['--laps']??1),weather=args['--weather']??'dry';
const grid=(args['--grid']??args['--bot']??'').split(',');const maxTicks=Number(args['--max-ticks']??10800*laps);
if(track!=='study'||weather!=='dry'||!Number.isSafeInteger(seed)||seed<0||seed>4294967295||!Number.isInteger(laps)||laps<1||laps>20||!grid.length||grid.length>7||grid.some(x=>!x)||!Number.isInteger(maxTicks)||maxTicks<1||maxTicks>10800*laps)throw Error('Invalid race arguments');
let state=seed>>>0;Math.random=()=>{state=(state+0x6d2b79f5)>>>0;let n=state;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return ((n^(n>>>14))>>>0)/4294967296;};
const bots=[];let field;
try{
 for(const entry of grid)bots.push(entry==='baseline'?null:await createIsolatedBot(entry,seed));
 field=await Opponents.create(new THREE.Scene(),createBarrierSurface(),seed);
 for(const r of field.racers.splice(grid.length)){r.physics.dispose();r.model.dispose();}
 field.setVehicleDesign('orbit');field.setAutomaticPit(false);field.reset({mode:'race',difficulty:'club',laps});
 const slots=arenaGridSlots(seed,grid.length);
 const cars=field.racers.map((r,i)=>{if(bots[i])field.setRivalDrivingBot(i,bots[i]);const p=startingGridSlot(slots[i]);r.physics.reset(p.x,p.z,p.heading);r.progress.reset(p.t,p.distance);r.gridLane=r.lane=p.offset;r.gridStart=p.distance;r.gridSlot=slots[i];return {botId:bots[i]?.id??'baseline',startSlot:slots[i],lapTimes:[],lastLap:0,offTrackCount:0,wallHitCount:0,off:false,wall:false};});
 let tick=0;for(;tick<maxTicks;tick++){
  const time=(tick+1)/60;field.step(1/60,time,null);
  for(const [i,r] of field.racers.entries()){
   const c=cars[i];if(c.finishTime!==undefined)continue;const p=r.physics,n=nearestTrack(p.position.x,p.position.z,p.position.y),outside=!(n.distance<trackHalfWidthAt(n.t)+.3&&Math.abs(p.position.y-(n.y??0)-.08)<.7);
   if(outside&&!c.off)c.offTrackCount++;c.off=outside;if(p.barrierContact&&!c.wall)c.wallHitCount++;c.wall=p.barrierContact;
   while(r.progress.distance>=c.lapTimes.length+1&&c.lapTimes.length<laps){c.lapTimes.push(time-c.lastLap);c.lastLap=time;}if(r.progress.finishedAt!==null)c.finishTime=time;
  }if(cars.every(c=>c.finishTime!==undefined)){tick++;break;}
 }
 const result={gameSimulation:true,official:false,track,seed,weather,laps,difficulty:'club',vehicle:'orbit',ticks:tick,cars:cars.map((c,i)=>{const totalTime=c.finishTime??tick/60;return {botId:c.botId,startSlot:c.startSlot,lapTimes:c.lapTimes,bestLap:c.lapTimes.length?Math.min(...c.lapTimes):null,totalTime,wallHitCount:c.wallHitCount,offTrackCount:c.offTrackCount,finished:c.lapTimes.length===laps,timeoutCount:bots[i]?.timeoutCount??0,errorCount:bots[i]?.errorCount??0,recoveries:field.racers[i].recoveries,penalizedTotalTime:penalizedTime(totalTime,c.wallHitCount)};})};
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{field?.dispose();await Promise.all(bots.map(b=>b?.close()));}
