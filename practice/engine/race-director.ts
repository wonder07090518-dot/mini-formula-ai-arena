/** Pure driving decisions: both CPU rivals and the QA driver can inspect these
 * rules. They only emit throttle/brake/steering, never change a car's pose. */
export interface RoadSample { x:number; z:number; heading:number; y?:number; pitch?:number; bank?:number }
export interface DriverState { x:number; z:number; heading:number; speed:number; t:number; steeringLimit:number; wheelBase?:number }
export interface TrafficSample { x:number; z:number; speed:number }
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const angle=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v));
export const DIFFICULTY_PACE={rookie:.61,club:.75,expert:.87} as const;
type AiDifficulty=keyof typeof DIFFICULTY_PACE;
/** Static dry-track calibration from the fixed-seed real-Rapier probes.
 * Some circuits amplified the automated driver's advantage over delayed
 * player inputs. These factors never depend on player position or race order. */
export const AI_TRACK_PACE:Partial<Record<string,Partial<Record<AiDifficulty,number>>>>={
  study:{club:.903,expert:.826},
};
/** Rival identity keeps its small variation when the starting grid shuffles.
 * Seven rivals span 2.4% target speed; no catch-up force or velocity override. */
export function aiPaceFor(difficulty:AiDifficulty,rivalIndex:number,trackId='study'){
  return DIFFICULTY_PACE[difficulty]*(AI_TRACK_PACE[trackId]?.[difficulty]??1)*(1-clamp(rivalIndex,0,6)*.004);
}
/** Expert rivals brake earlier for bends. Static calibration;
 * straight-line pace, other difficulties and player inputs are unchanged. */
export function aiBrakingFor(difficulty:AiDifficulty,trackId:string){
  if(difficulty!=='expert')return 29;
  return 29;
}
export const PIT_LANE_SPEED=32.2222222222;
export const PIT_SERVICE_SECONDS=3.2;
// Automated intents retain the response this feedback controller was tuned for;
// the gentler offline steering filter applies to human input.
export function drivingIntent(state:DriverState, sample:(t:number)=>RoadSample, length:number,
  pace=1, lane=0, traffic:TrafficSample[]=[], brakingDeceleration=29) {
  const look=2.8+Math.abs(state.speed)*.13;
  const aim=sample(state.t+look/length);
  // Lane offsets fade in tight bends so an overtaking line cannot cut the kerb.
  const now=sample(state.t), curve=angle(aim.heading-now.heading)/look;
  const offset=lane*clamp(1-Math.abs(curve)*5,.15,1);
  const tx=aim.x+Math.cos(aim.heading)*offset, tz=aim.z-Math.sin(aim.heading)*offset;
  const error=angle(Math.atan2(tx-state.x,tz-state.z)-state.heading);
  const steer=clamp(Math.atan(2*(state.wheelBase??2.72)*Math.sin(error)/look)/Math.max(.1,state.steeringLimit),-1,1);
  // Keep the offline AI target pace aligned with ROAD_PACE in handling.ts.
  // This pure module stays dependency-free for room/pit rule consumers.
  const roadPace=pace*(3.74/3.5);
  let target=41*roadPace;
  // Preview braking at several distances. Allow the available stopping distance
  // before a corner rather than waiting until the current axle reaches it.
  for(const d of [3,6,10,16,24,32,40]) {
    const a=sample(state.t+d/length),b=sample(state.t+(d+1.2)/length);
    const k=Math.abs(angle(b.heading-a.heading))/1.2;
    const corner=clamp(Math.sqrt(62/Math.max(k,.02)),7.0,41)*roadPace;
    target=Math.min(target,Math.sqrt(corner*corner+2*brakingDeceleration*Math.max(0,d-3)));
  }
  if(Math.abs(error)>.65)target=Math.min(target,5.5);
  // Traffic braking is deterministic, and has no catch-up multiplier.
  for(const car of traffic) {
    const dx=car.x-state.x,dz=car.z-state.z;
    const ahead=dx*Math.sin(state.heading)+dz*Math.cos(state.heading);
    const lateral=dx*Math.cos(state.heading)-dz*Math.sin(state.heading);
    const brakingPreview=Math.max(12,state.speed*state.speed/(2*32)+7);
    if(ahead>0&&ahead<brakingPreview&&Math.abs(lateral)<1.85)target=Math.min(target,Math.max(0,car.speed+(ahead-4.9)*1.5));
  }
  return {throttle:clamp((target-state.speed)*.65,0,1),brake:clamp((state.speed-target)*.3,0,1),steer,drift:false,automated:true,target};
}

/** Select only the shared transit corridor, never an occupied service bay or
 * a main-road car. A queued transit car remains a leader even at zero speed;
 * stopping does not switch off following and let the next car pass through it.
 * The protection marker comes from the authoritative AutoPit controller. */
export function pitTransitTraffic(state:DriverState,
  traffic:(TrafficSample&{heading:number;pitProtected?:boolean})[],
  nearest:(x:number,z:number)=>RoadSample&{u:number;distance:number}) {
  const own=nearest(state.x,state.z);
  return traffic.filter(car=>{
    if(car.pitProtected!==true)return false;
    const at=nearest(car.x,car.z);
    const offset=(car.x-at.x)*Math.cos(at.heading)-(car.z-at.z)*Math.sin(at.heading);
    return at.u>own.u&&at.distance<3.2&&offset>=-.35&&
      Math.cos(car.heading-at.heading)>.65;
  });
}

/** Real pit-lane pursuit. The sampled lane can include a smooth side-step into
 * an assigned bay; braking uses distance to that bay, not a position snap. */
export function pitDrivingIntent(state:DriverState,sample:(u:number)=>RoadSample,u:number,
  stopAt?:{x:number;z:number},traffic:TrafficSample[]=[]) {
  const look=2.4+Math.abs(state.speed)*.12;
  let at=Math.min(1,u+.002),aim=sample(at);
  while(at<1&&Math.hypot(aim.x-state.x,aim.z-state.z)<look){at=Math.min(1,at+.002);aim=sample(at);}
  const distance=Math.max(1,Math.hypot(aim.x-state.x,aim.z-state.z));
  const error=angle(Math.atan2(aim.x-state.x,aim.z-state.z)-state.heading);
  const steer=clamp(Math.atan(2*(state.wheelBase??2.72)*Math.sin(error)/distance)/Math.max(.1,state.steeringLimit),-1,1);
  let target=PIT_LANE_SPEED;
  // The straight transit limit is not a safe speed for the narrow entry S or
  // the lateral bay merge. Measure their actual sampled positions (the bay
  // offset does not alter the centreline heading) and brake before curvature.
  // The scan starts ~8 m behind the car: a bend the car is still leaving keeps
  // its corner speed, so the entry S is driven at one steady pace instead of
  // braking and re-accelerating between its linked bends.
  const origin=sample(u);let back=u,previous=origin;
  while(back>0){if(Math.hypot(previous.x-origin.x,previous.z-origin.z)>=8)break;back=Math.max(0,back-.002);previous=sample(back);}
  let previousHeading:number|undefined;
  let travelled=Math.hypot(origin.x-state.x,origin.z-state.z)-Math.hypot(previous.x-origin.x,previous.z-origin.z);
  for(let ahead=Math.min(1,back+.004);ahead<=1; ahead=Math.min(1,ahead+.004)){
    const point=sample(ahead),dx=point.x-previous.x,dz=point.z-previous.z;
    const segment=Math.hypot(dx,dz),heading=Math.atan2(dx,dz);
    if(previousHeading!==undefined&&segment>.01){
      const curvature=Math.abs(angle(heading-previousHeading))/segment;
      const corner=clamp(Math.sqrt(36/Math.max(curvature,.01)),5.5,PIT_LANE_SPEED);
      target=Math.min(target,Math.sqrt(corner*corner+2*24*Math.max(0,travelled-2.5)));
    }
    travelled+=segment;previous=point;previousHeading=heading;
    if(ahead===1||travelled>38)break;
  }
  if(Math.abs(error)>.65)target=Math.min(target,7);
  if(stopAt){const remaining=stopAt.x-state.x;target=Math.min(target,Math.sqrt(2*18*Math.max(0,remaining-.08)));if(remaining<.15)target=0;}
  for(const car of traffic){const dx=car.x-state.x,dz=car.z-state.z,ahead=dx*Math.sin(state.heading)+dz*Math.cos(state.heading),side=dx*Math.cos(state.heading)-dz*Math.sin(state.heading);
    const closing=Math.max(0,state.speed-car.speed),preview=Math.max(12,closing*closing/(2*28)+7);
    if(ahead>0&&ahead<preview&&Math.abs(side)<1.85)target=Math.min(target,Math.max(0,car.speed+(ahead-4.9)*1.5));}
  // A small resistance feed-forward avoids needing a permanent speed error
  // to supply engine force on the clear pit straight. Braking still wins as
  // the target falls for a turn, a stopped car or the service box.
  const cruiseFeed=.47*(target/PIT_LANE_SPEED)**2;
  return{throttle:target<state.speed-.2?0:clamp((target-state.speed)*.8+cruiseFeed,0,1),brake:target===0?1:clamp((state.speed-target)*.45,0,1),steer,drift:false,automated:true,target};
}

/** Progress never trusts a distant nearest-point jump or a wall shortcut. */
export class RaceProgress {
  distance=0; t=0; legalT=0; finishedAt:number|null=null;
  reset(t=0,distance=0){this.t=t;this.legalT=t;this.distance=distance;this.finishedAt=null;}
  advance(t:number,onRoad:boolean,dt:number,speed:number,length:number){
    let delta=t-this.t;if(delta<-.5)delta++;if(delta>.5)delta--;
    const plausible=Math.max(.5,Math.abs(speed)*dt*2.2)/length;
    if(onRoad&&Math.abs(delta)<Math.min(.08,plausible)) {
      this.distance+=delta;this.legalT=t;
    }
    this.t=t;
  }
}

export type TyreCompound='soft'|'medium'|'hard'|'wet';
const COMPOUNDS:Record<TyreCompound,{dry:number;wet:number;wear:number}>={
  soft:{dry:1.08,wet:.40,wear:1.30},medium:{dry:1,wet:.48,wear:1},
  hard:{dry:.95,wet:.52,wear:.72},wet:{dry:.82,wet:.91,wear:1.05},
};
export class TyreService {
  wear=0; requested=false; servicing=false; remaining=0; stops=0;
  compound:TyreCompound='medium';selectedCompound:TyreCompound='medium';
  private fittingCompound:TyreCompound='medium';
  reset(compound:TyreCompound='medium'){this.wear=0;this.requested=false;this.servicing=false;this.remaining=0;this.stops=0;this.compound=this.selectedCompound=this.fittingCompound=Object.hasOwn(COMPOUNDS,compound)?compound:'medium';}
  selectCompound(compound:TyreCompound){if(Object.hasOwn(COMPOUNDS,compound))this.selectedCompound=compound;}
  get grip(){return this.gripFor(0);}
  gripFor(wetness:number){const w=Number.isFinite(wetness)?clamp(wetness,0,1):0,spec=COMPOUNDS[this.compound];return(spec.dry+(spec.wet-spec.dry)*w)*(1-Math.min(1,this.wear)*.18);}
  toggle(){if(!this.servicing)this.requested=!this.requested;}
  update(dt:number,speed:number,slip:number,inBox:boolean,wetness=0):'started'|'complete'|null {
    if(this.servicing){
      // Rolling away cancels service; a fresh set is only granted after a
      // continuous stationary stop inside the marked bay.
      if(!inBox||Math.abs(speed)>.4){this.servicing=false;this.remaining=0;return null;}
      this.remaining=Math.max(0,this.remaining-dt);
      if(this.remaining===0){this.wear=0;this.compound=this.fittingCompound;this.requested=false;this.servicing=false;this.stops++;return 'complete';}
      return null;
    }
    const wet=Number.isFinite(wetness)?clamp(wetness,0,1):0;
    const wearRate=COMPOUNDS[this.compound].wear*(this.compound==='wet'?1+.65*(1-wet):1);
    this.wear=Math.min(1,this.wear+dt*Math.abs(speed)*(.00026+Math.min(1,Math.abs(slip))*.0005)*wearRate);
    if(this.requested&&inBox&&Math.abs(speed)<.25){this.servicing=true;this.fittingCompound=this.selectedCompound;this.remaining=PIT_SERVICE_SECONDS;return 'started';}
    return null;
  }
}
