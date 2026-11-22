// Inlined (not imported from ./draft-content) so standalone test loaders can compile this module alone.
const DRAFT_CONTENT = typeof location !== 'undefined' && new URLSearchParams(location.search).get('draft') === '1';
const DRAFT_TRACK_IDS: readonly string[] = [];
import * as THREE from 'three';
import { VEHICLE_SPEC } from './vehicle-spec';
/** y is road elevation above the .08 base; pitch uphill+, bank right side up+. */
export interface TrackPoint { x: number; y: number; z: number; heading: number; pitch: number; bank: number }
export type TrackId = 'study';
export interface TrackContext { y?: number; previousT?: number }
export const BASE_TRACK_Y = .08;
/** The room grows around the car; wheel/road dimensions are not multiplied. */
export const CIRCUIT_SCALE = 4;
export const ROOM_HALF_WIDTH = 36*CIRCUIT_SCALE;
export const ROOM_HALF_DEPTH = 32*CIRCUIT_SCALE;
export const ROOM_BOUND_X = ROOM_HALF_WIDTH;
export const ROOM_BOUND_Z = ROOM_HALF_DEPTH;
export const ROOM_FLOOR_Y = -.08*CIRCUIT_SCALE;
const flat = (p: {x:number;z:number;heading:number}):TrackPoint => ({...p,y:0,pitch:0,bank:0});
export const TRACKS = [{id:'study',title:'Study',detail:''}];
const wrap = (t:number) => ((t % 1) + 1) % 1;
export function createTrackLayout(id: TrackId) {
 if(id !== 'study') throw Error('Only study is available');
 const count=7680;
 const points: TrackPoint[] = [], distances = [0];
  type Segment={length:number;at:(u:number)=>{x:number;z:number}};
  const line=(ax:number,az:number,bx:number,bz:number):Segment=>({length:Math.hypot(bx-ax,bz-az),at:u=>({x:ax+(bx-ax)*u,z:az+(bz-az)*u})});
  const arc=(cx:number,cz:number,r:number,a:number,b:number):Segment=>({length:Math.abs(b-a)*r,at:u=>({x:cx+r*Math.cos(a+(b-a)*u),z:cz+r*Math.sin(a+(b-a)*u)})});
  // Exact tangent arcs, including two deliberately slower R10–24 bends. The
  // room grows 4x, while this twelve-unit road remains proportionate to the car.
  const diagonal=(ax:number,az:number,bx:number,bz:number):Segment=>{
    const at=(u:number)=>({x:ax+(bx-ax)*u,z:az+(bz-az)*(3*u*u-2*u*u*u)});
    let length=0,previous=at(0);for(let i=1;i<=100;i++){const p=at(i/100);length+=Math.hypot(p.x-previous.x,p.z-previous.z);previous=p;}
    return{length,at};
  };
  const sampledSegment=(at:(u:number)=>{x:number;z:number},smooth=false):Segment=>{
    let length=0,prev=at(0);for(let i=1;i<=300;i++){const p=at(i/300);length+=Math.hypot(p.x-prev.x,p.z-prev.z);prev=p;}
    // Reparameterize custom curves by arc length so speed, grade and lookup
    // fractions all describe the same physical metres.
    const samples=Array.from({length:301},(_,i)=>at(i/300)),ds=[0];
    for(let i=1;i<samples.length;i++)ds.push(ds[i-1]+Math.hypot(samples[i].x-samples[i-1].x,samples[i].z-samples[i-1].z));
    return{length,at:u=>{const d=u*length;let lo=0,hi=300;while(hi-lo>1){const m=(lo+hi)>>>1;if(ds[m]<=d)lo=m;else hi=m;}const a=(d-ds[lo])/(ds[lo+1]-ds[lo]);if(smooth)return at((lo+a)/300);return{x:THREE.MathUtils.lerp(samples[lo].x,samples[lo+1].x,a),z:THREE.MathUtils.lerp(samples[lo].z,samples[lo+1].z,a)};}};
  };
  const smoothSegment=(at:(u:number)=>{x:number;z:number})=>sampledSegment(at,true);
  const sumLength=(segments:Segment[])=>segments.reduce((sum,s)=>sum+s.length,0);
  const studySegments:Segment[]=[
    line(0,88,114,88),arc(114,68,20,Math.PI/2,0),
    line(134,68,134,36),arc(114,36,20,0,-Math.PI/2),
    smoothSegment(u=>{const x=114-220*u;let z=16;if(x>50)z+=12*Math.sin(Math.PI*(114-x)/64)**2;else if(x< -50)z-=10*Math.sin(Math.PI*(-50-x)/56)**2;return{x,z};}),arc(-106,-4,20,Math.PI/2,Math.PI),
    line(-126,-4,-126,-74),arc(-106,-74,20,Math.PI,3*Math.PI/2),
    smoothSegment(u=>{const x=-106+216*u;return{x,z:-94+(x< -26?14*Math.sin(Math.PI*(x+106)/80)**2:0)};}),arc(110,-72,22,-Math.PI/2,0),
    line(132,-72,132,-50),arc(110,-50,22,0,Math.PI/2),
    smoothSegment(u=>{const x=110-152*u;return{x,z:-28+(x>55?8*Math.sin(Math.PI*(110-x)/55)**2:0)};}),arc(-42,-10,18,-Math.PI/2,-Math.PI),
    line(-60,-10,-60,34),arc(-82,34,22,0,Math.PI/2),
    line(-82,56,-106,56),arc(-106,72,16,-Math.PI/2,-3*Math.PI/2),
    line(-106,88,0,88),
  ];
  const studyLength=sumLength(studySegments);
  function studyPosition(t:number){let d=wrap(t)*studyLength;for(const seg of studySegments){if(d<=seg.length)return seg.at(d/seg.length);d-=seg.length;}return studySegments[0].at(0);}
  const studyRise=(sumLength(studySegments.slice(0,5))-36)/studyLength;
  const studyTop=sumLength(studySegments.slice(0,8))/studyLength;
  const studyDescent=sumLength(studySegments.slice(0,14))/studyLength;
  const studyGround=(sumLength(studySegments.slice(0,18))+10)/studyLength;
  const transformed=studyPosition;
  for (let i = 0; i <= count; i++) {
    const p = transformed(i/count), a = transformed(i/count-.00001), b = transformed(i/count+.00001);
    points.push(flat({ ...p, heading: Math.atan2(b.x-a.x,b.z-a.z) }));
    if (i) distances.push(distances[i - 1] + Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z));
  }
  const length = distances[count];
  // A spatial index keeps the much longer circuit cheap to query at 60Hz.
  // The full scan remains an exact fallback for off-circuit recovery queries.
  const cells=new Map<string,number[]>(),cellSize=12;
  for(let i=0;i<count;i++){
    const a=points[i],b=points[i+1];
    for(let x=Math.floor(Math.min(a.x,b.x)/cellSize);x<=Math.floor(Math.max(a.x,b.x)/cellSize);x++)
      for(let z=Math.floor(Math.min(a.z,b.z)/cellSize);z<=Math.floor(Math.max(a.z,b.z)/cellSize);z++){
        const key=x+','+z,bucket=cells.get(key);if(bucket)bucket.push(i);else cells.set(key,[i]);
      }
  }
  // Distribute climb by the shortest lateral path, not just centre-line metres.
  // On a tight inside bend the inner edge travels far less distance; a simple
  // sine bump there produced a hidden 35% edge grade despite a 14% centre grade.
  const rawWeights=points.map((_,i)=>{
    const a=points[(i-1+count)%count],b=points[(i+1)%count];
    const turn=Math.abs(Math.atan2(Math.sin(b.heading-a.heading),Math.cos(b.heading-a.heading)));
    return Math.max(.15,1-7.125*turn/(2*length/count));
  });
  const conservativeWeights=rawWeights.map((_,i)=>Math.min(...rawWeights.slice(Math.max(0,i-10),Math.min(count+1,i+11))));
  const weights=conservativeWeights.map((_,i)=>{
    const nearby=conservativeWeights.slice(Math.max(0,i-5),Math.min(count+1,i+6));return nearby.reduce((sum,w)=>sum+w,0)/nearby.length;
  });
  const weightedDistances=[0];
  for(let i=1;i<=count;i++)weightedDistances.push(weightedDistances[i-1]+(weights[i-1]+weights[i])*.5*(distances[i]-distances[i-1]));
  const weightedSample={s:0,weight:0};
  function weightedAt(t:number) {
    const s=t*length;let lo=0,hi=count;
    while(hi-lo>1){const mid=(lo+hi)>>>1;if(distances[mid]<=s)lo=mid;else hi=mid;}
    const ds=distances[lo+1]-distances[lo],d=s-distances[lo],slope=(weights[lo+1]-weights[lo])/ds;
    weightedSample.s=weightedDistances[lo]+weights[lo]*d+.5*slope*d*d;weightedSample.weight=weights[lo]+slope*d;return weightedSample;
  }
  const profileSample={y:0,pitch:0,bank:0};
  function profileResult(y:number,pitch:number,bank:number){profileSample.y=y;profileSample.pitch=pitch;profileSample.bank=bank;return profileSample;}
  const hills=[{start:.19,end:.47,height:9},{start:.48,end:.92,height:18}].map(hill=>{const weightedStart=weightedAt(hill.start).s;return{...hill,weightedStart,span:weightedAt(hill.end).s-weightedStart};});
  const blends=new Map<number,Map<number,{start:number;span:number}>>();
  function blendProfile(t:number,a:number,b:number,from:number,to:number){
    let ranges=blends.get(a);if(!ranges){ranges=new Map();blends.set(a,ranges);}
    let range=ranges.get(b);if(!range){const start=weightedAt(a).s;range={start,span:weightedAt(b).s-start};ranges.set(b,range);}
    const {start,span}=range,at=weightedAt(t),u=THREE.MathUtils.clamp((at.s-start)/span,0,1);
    return profileResult(from+(to-from)*u*u*(3-2*u),Math.atan((to-from)*6*u*(1-u)*at.weight/span),0);
  }
  function profile(t:number) {
    t=wrap(t);
    if(t<=studyRise||t>=studyGround)return profileResult(0,0,0);
    if(t<studyTop)return blendProfile(t,studyRise,studyTop,0,20);
    if(t<=studyDescent)return profileResult(20,0,0);
    return blendProfile(t,studyDescent,studyGround,20,0);
  }
  function interpolate(index: number, alpha: number): TrackPoint {
    const a = points[index], b = points[index + 1];
    const dh = Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading));
    const t=(distances[index]+alpha*(distances[index+1]-distances[index]))/length;
    return { x: a.x + (b.x - a.x) * alpha, z: a.z + (b.z - a.z) * alpha, heading: a.heading + dh * alpha,...profile(t) };
  }
  function point(t: number): TrackPoint {
    const distance = wrap(t) * length;
    let lo = 0, hi = count;
    while (hi - lo > 1) { const mid = (lo + hi) >>> 1; if (distances[mid] <= distance) lo = mid; else hi = mid; }
    return interpolate(lo, (distance - distances[lo]) / (distances[lo + 1] - distances[lo]));
  }
  const candidateMarks=new Uint32Array(count),candidates:number[]=[];let candidateGeneration=0;
  function nearest(x: number, z: number, context?:number|TrackContext) {
    const y=typeof context==='number'?context:context?.y;
    let best = Infinity, index = 0, alpha = 0;
    candidates.length=0;if(++candidateGeneration>0xffffffff){candidateMarks.fill(0);candidateGeneration=1;}
    const cx=Math.floor(x/cellSize),cz=Math.floor(z/cellSize);
    for(let a=cx-1;a<=cx+1;a++)for(let b=cz-1;b<=cz+1;b++)for(const i of cells.get(a+','+b)??[]){if(candidateMarks[i]!==candidateGeneration){candidateMarks[i]=candidateGeneration;candidates.push(i);}}
    const visit=(i:number)=>{
      const a = points[i], b = points[i + 1], dx = b.x - a.x, dz = b.z - a.z;
      const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      const height=y===undefined?0:(profile((distances[i]+t*(distances[i+1]-distances[i]))/length).y+BASE_TRACK_Y-y)**2;
      const d = (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2 + height;
      if (d < best) { best = d; index = i; alpha = t; }
    };
    for(const i of candidates)visit(i);
    if(best>=cellSize**2)for(let i=0;i<count;i++)if(candidateMarks[i]!==candidateGeneration)visit(i);
    const p = interpolate(index, alpha);
    return { ...p, t: wrap((distances[index] + alpha * (distances[index + 1] - distances[index])) / length),
      distance: Math.hypot(x-p.x,z-p.z), signedDistance: (x - p.x) * Math.cos(p.heading) - (z - p.z) * Math.sin(p.heading) };
  }
  return { id, length, point, nearest };
}
export function createRaceTrackContext(id: TrackId) {
const CURRENT_TRACK_ID = id;
const IS_GRAND_PRIX = true;
const ACTIVE_TRACK = createTrackLayout(CURRENT_TRACK_ID);
const TRACK_LENGTH = ACTIVE_TRACK.length;
const trackPoint = ACTIVE_TRACK.point;
const nearestTrack = ACTIVE_TRACK.nearest;
const TRACK_HALF_WIDTH = IS_GRAND_PRIX?6:3.25;
const TRACK_RAIL_OFFSET = TRACK_HALF_WIDTH+1.05;
const TRACK_SAMPLES = IS_GRAND_PRIX?2048:320;
/** Shared adventure authority for geometry, collision, AI and water recovery. */
const BATH_ADVENTURE={enabled:false,approachT:0,entryT:0,exitT:0,endT:0,checkpointT:0,recoveryT:0,waterY:0,waterContains:(_x:number,_z:number)=>false,dangerContains:(_t:number)=>false};
function trackHalfWidthAt(t:number){
  // Seventeen-unit finish straight and pit merge apron; smooth width tapers
  // preserve the authored bend radii. Geometry AND suspension use this width.
  if(IS_GRAND_PRIX){const p=trackPoint(t);
    if(Math.abs(p.z-88)<.025&&Math.sin(p.heading)>.999){
      const ease=(v:number)=>{v=THREE.MathUtils.clamp(v,0,1);return v*v*(3-2*v);};
      return TRACK_HALF_WIDTH+2.5*ease((p.x+100)/22)*ease((114-p.x)/24);
    }
  }
  if(!BATH_ADVENTURE.enabled)return TRACK_HALF_WIDTH;
  const d=wrap(t)*TRACK_LENGTH,a=BATH_ADVENTURE.entryT*TRACK_LENGTH,b=BATH_ADVENTURE.exitT*TRACK_LENGTH;
  const u=THREE.MathUtils.clamp(Math.min((d-(a-24))/24,((b+24)-d)/24),0,1);
  return TRACK_HALF_WIDTH-(TRACK_HALF_WIDTH-3.75)*u*u*(3-2*u);
}
const trackRailOffsetAt=(t:number)=>trackHalfWidthAt(t)+1.05;
/** Dangerous bridge edge has no concealed runoff ledge outside its paint. */
function roadShoulderAt(t:number){return BATH_ADVENTURE.dangerContains(t)?0:1.1;}
const roadHasSkirtAt=(t:number)=>!BATH_ADVENTURE.enabled||wrap(t)<BATH_ADVENTURE.approachT||wrap(t)>BATH_ADVENTURE.endT;


/** Orthonormal road frame, used by visual vertices, collision and reset poses. */
function trackFrame(p:TrackPoint) {
  const forward=new THREE.Vector3(Math.sin(p.heading)*Math.cos(p.pitch),Math.sin(p.pitch),Math.cos(p.heading)*Math.cos(p.pitch));
  const horizontalRight=new THREE.Vector3(Math.cos(p.heading),0,-Math.sin(p.heading));
  const unbankedUp=new THREE.Vector3().crossVectors(forward,horizontalRight);
  const right=horizontalRight.clone().multiplyScalar(Math.cos(p.bank)).addScaledVector(unbankedUp,Math.sin(p.bank));
  const up=unbankedUp.multiplyScalar(Math.cos(p.bank)).addScaledVector(horizontalRight,-Math.sin(p.bank));
  return{forward,right,up};
}
function surfacePoint(t:number,offset=0,height=BASE_TRACK_Y):TrackPoint {
  const p=trackPoint(t),f=trackFrame(p),v=new THREE.Vector3(p.x,p.y+BASE_TRACK_Y,p.z).addScaledVector(f.right,offset).addScaledVector(f.up,height-BASE_TRACK_Y);
  return{...p,x:v.x,y:v.y,z:v.z};
}
function roadHeightAt(x:number,z:number,y?:number):number {
  const p=nearestTrack(x,z,y);
  return surfacePoint(p.t,p.signedDistance/Math.cos(p.bank)).y;
}
/** The existing staggered stop lines are the shared render/spawn authority. */
const STARTING_GRID=Object.freeze({count:8,step:4.6,paintWidth:.07,
  boxLength:VEHICLE_SPEC.length+.9,boxWidth:VEHICLE_SPEC.width+.8});
function startingGridSlot(slot:number){
  if(slot===0)return{slot,t:0,distance:0,offset:0,...surfacePoint(0,0)};
  const stopDistance=-slot*STARTING_GRID.step;
  const distance=(stopDistance-STARTING_GRID.boxLength/2)/TRACK_LENGTH,t=((distance%1)+1)%1;
  const offset=(slot%2===1?-1:1)*(IS_GRAND_PRIX?2.1:1.45);
  return{slot,t,distance,offset,...surfacePoint(t,offset)};
}
const TUNNEL={enabled:false,minX:0,maxX:0,minZ:0,maxZ:0,ceilingY:0,cameraEyeY:0,contains:(_x:number,_z:number)=>false};
const pitEntry=ACTIVE_TRACK.nearest(-96,88),pitExit=ACTIVE_TRACK.nearest(96,88);
function pitLanePoint(u:number):TrackPoint {
  const x=THREE.MathUtils.lerp(pitEntry.x,pitExit.x,THREE.MathUtils.clamp(u,0,1));
  const edge=x< -78?(x-pitEntry.x)/(-78-pitEntry.x):x>78?(pitExit.x-x)/(pitExit.x-78):1;
  const a=THREE.MathUtils.clamp(edge,0,1),blend=a*a*a*(10+a*(-15+6*a));
  const dzdx=edge>=1?0:14*30*a*a*(1-a)*(1-a)*(x< -78?1/(-78-pitEntry.x):-1/(pitExit.x-78));
  return flat({x,z:88+14*blend,heading:Math.atan2(1,dzdx)});
}
const pitPoints=Array.from({length:257},(_,i)=>pitLanePoint(i/256));
function pitLaneNearest(x:number,z:number){
  let best=Infinity,index=0,alpha=0;
  for(let i=0;i<256;i++){
    const a=pitPoints[i],b=pitPoints[i+1],dx=b.x-a.x,dz=b.z-a.z;
    const u=THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1),d=(x-a.x-u*dx)**2+(z-a.z-u*dz)**2;
    if(d<best){best=d;index=i;alpha=u;}
  }
  return{...pitLanePoint((index+alpha)/256),u:(index+alpha)/256,distance:Math.sqrt(best)};
}
const pitBoxes=[-70,-50,-30,-10,10,30,50,70].map((x,id)=>({id,number:id+1,x,z:103.5,heading:Math.PI/2}));
const PIT={enabled:IS_GRAND_PRIX,entryT:pitEntry.t,exitT:pitExit.t,width:6,samples:256,
  entry:pitEntry,exit:pitExit,boxes:pitBoxes,box:pitBoxes[3],
  contains:(x:number,z:number)=>IS_GRAND_PRIX&&Math.abs(x)<100&&z>88+TRACK_HALF_WIDTH+.1&&z<106&&pitLaneNearest(x,z).distance<4,
  inBox:(x:number,z:number,boxIndex=3)=>IS_GRAND_PRIX&&Math.abs(x-pitBoxes[boxIndex].x)<2.4&&Math.abs(z-pitBoxes[boxIndex].z)<.85};
function mainBarrierOpen(t:number,side:number):boolean {
  if(BATH_ADVENTURE.dangerContains(t))return true;
  if(!PIT.enabled||side!==-1)return false;const p=trackPoint(t);
  return Math.abs(p.z-88)<.01&&((p.x>pitEntry.x&&p.x< -72)||(p.x>72&&p.x<pitExit.x));
}
return {CURRENT_TRACK_ID,IS_GRAND_PRIX,ACTIVE_TRACK,TRACK_LENGTH,trackPoint,nearestTrack,TRACK_HALF_WIDTH,TRACK_RAIL_OFFSET,TRACK_SAMPLES,BATH_ADVENTURE,trackHalfWidthAt,trackRailOffsetAt,roadShoulderAt,roadHasSkirtAt,trackFrame,surfacePoint,roadHeightAt,STARTING_GRID,startingGridSlot,TUNNEL,pitLanePoint,pitLaneNearest,PIT,mainBarrierOpen};
}
export type RaceTrackContext = ReturnType<typeof createRaceTrackContext>;
export const ACTIVE_TRACK_CONTEXT = createRaceTrackContext('study');
export const {CURRENT_TRACK_ID,IS_GRAND_PRIX,ACTIVE_TRACK,TRACK_LENGTH,trackPoint,nearestTrack,TRACK_HALF_WIDTH,TRACK_RAIL_OFFSET,TRACK_SAMPLES,BATH_ADVENTURE,trackHalfWidthAt,trackRailOffsetAt,roadShoulderAt,roadHasSkirtAt,trackFrame,surfacePoint,roadHeightAt,STARTING_GRID,startingGridSlot,TUNNEL,pitLanePoint,pitLaneNearest,PIT,mainBarrierOpen} = ACTIVE_TRACK_CONTEXT;
