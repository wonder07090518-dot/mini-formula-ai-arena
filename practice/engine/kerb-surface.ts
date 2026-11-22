import { ACTIVE_TRACK_CONTEXT, ROOM_FLOOR_Y, type RaceTrackContext } from './track-layout';

export interface TrackSurface { vertices: Float32Array; indices: Uint32Array }
// The same closed profile drives rendering AND suspension collision. Tiny paint
// pores are shading only: they cannot hook a tyre or become hidden speed bumps.
export const KERB_PROFILE = [
  [3.25,.085],[3.275,.088],[3.30,.096],[3.62,.164],[3.66,.170],[3.69,.164],[3.70,.150],
  [3.70,.052],[3.25,.052],
] as const;


export function createKerbSurface(context:RaceTrackContext=ACTIVE_TRACK_CONTEXT): TrackSurface & { uvs: Float32Array; heights:Float32Array; groups: [number,number,number][] } {
  const {TRACK_SAMPLES:SAMPLES,trackHalfWidthAt,surfacePoint,TRACK_LENGTH,mainBarrierOpen}=context;
  const positions: number[] = [], uvs: number[] = [], heights:number[]=[], colors: number[][] = [[],[]];
  const profile = KERB_PROFILE, stride = profile.length;
  for (const side of [-1,1]) {
    const start = positions.length/3;
    for (let i=0;i<=SAMPLES;i++) {
      for (const [offset,y] of profile) {
        const actualOffset=side*(offset-3.25+trackHalfWidthAt(i/SAMPLES)),p=surfacePoint(i/SAMPLES,actualOffset,y);
        positions.push(p.x,p.y,p.z);heights.push(y);
        // Retain canonical profile UVs for the calibrated paint-edge shader.
        uvs.push(i/SAMPLES*TRACK_LENGTH/3,side*offset/3);
      }
    }
    for(let i=0;i<SAMPLES;i++) for(let j=0;j<stride;j++) {
      if(mainBarrierOpen((i+.5)/SAMPLES,side))continue;
      const a=start+i*stride+j,b=start+(i+1)*stride+j,c=start+i*stride+(j+1)%stride,d=start+(i+1)*stride+(j+1)%stride;
      const indices=colors[Math.floor(i/4)%2];
      if(side>0) indices.push(a,b,c,c,b,d); else indices.push(a,c,b,c,d,b);
    }
  }
  return { vertices:new Float32Array(positions),uvs:new Float32Array(uvs),heights:new Float32Array(heights),indices:new Uint32Array([...colors[0],...colors[1]]),
    groups:[[0,colors[0].length,0],[colors[0].length,colors[1].length,1]] };
}

/** Watertight continuous guardrail collision: no overlapping box ends to snag. */
export function createBarrierSurface(context:RaceTrackContext=ACTIVE_TRACK_CONTEXT): TrackSurface {
  const {TRACK_SAMPLES:SAMPLES,surfacePoint,trackRailOffsetAt,mainBarrierOpen,PIT}=context;
  const positions: number[]=[],indices:number[]=[];
  for(const side of [-1,1]) {
    const base=positions.length/3;
    for(let i=0;i<SAMPLES;i++) {
      for(const [offset,y] of [[-.075,.08],[.075,.08],[.075,.68],[-.075,.68]]) {
        const p=surfacePoint(i/SAMPLES,side*(trackRailOffsetAt(i/SAMPLES)+offset),y);positions.push(p.x,p.y,p.z);
      }
    }
    for(let i=0;i<SAMPLES;i++)for(let j=0;j<4;j++) {
      if(mainBarrierOpen((i+.5)/SAMPLES,side))continue;
      const a=base+i*4+j,b=base+((i+1)%SAMPLES)*4+j,c=base+i*4+(j+1)%4,d=base+((i+1)%SAMPLES)*4+(j+1)%4;
      if(side>0)indices.push(a,c,b,c,d,b);else indices.push(a,b,c,c,b,d);
    }
    for(let i=0;i<SAMPLES;i++) {
      const before=mainBarrierOpen((i-.5+SAMPLES)/SAMPLES,side),after=mainBarrierOpen((i+.5)/SAMPLES,side);
      if(before===after)continue;const k=base+i*4;
      if(side*(after?1:-1)>0)indices.push(k,k+1,k+2,k,k+2,k+3);else indices.push(k,k+2,k+1,k,k+3,k+2);
    }
  }
  if(PIT.enabled) {
    const count=PIT.samples,base=positions.length/3;
    for(let i=0;i<=count;i++)for(const [offset,y] of [[-.075,.08],[.075,.08],[.075,.68],[-.075,.68]]) {
      const p=pitGuardPoint(i/count,offset,y,context);positions.push(p.x,p.y,p.z);
    }
    for(let i=0;i<count;i++)for(let j=0;j<4;j++){const a=base+i*4+j,b=a+4,c=base+i*4+(j+1)%4,d=c+4;indices.push(a,b,c,c,b,d);}
  }
  return {vertices:new Float32Array(positions),indices:new Uint32Array(indices)};
}

/** Outermost pit wall meets the main southern rail at both open merge mouths. */
export function pitGuardPoint(u:number,fold=0,height=.08,context:RaceTrackContext=ACTIVE_TRACK_CONTEXT) {
  const {pitLanePoint,trackRailOffsetAt,PIT}=context;
  const p=pitLanePoint(u),taper=Math.min(1,Math.min(u,1-u)/.18);
  const endpointRail=trackRailOffsetAt(u<.5?PIT.entryT:PIT.exitT);
  const eased=taper*taper*(3-2*taper),offset=-(endpointRail*(1-eased)+(PIT.width/2+.3)*eased+fold);
  return{...p,x:p.x+Math.cos(p.heading)*offset,y:height,z:p.z-Math.sin(p.heading)*offset};
}

/** Same exact road ribbons are consumed by Rapier and by the visible surface. */
export function createRoadSurface(context:RaceTrackContext=ACTIVE_TRACK_CONTEXT):TrackSurface {
  const {TRACK_SAMPLES:SAMPLES,surfacePoint,trackHalfWidthAt,roadShoulderAt,PIT,pitLanePoint}=context;
  const vertices:number[]=[],indices:number[]=[];
  const add=(count:number,point:(i:number,side:number)=>{x:number;y:number;z:number})=>{
    const start=vertices.length/3;
    for(let i=0;i<=count;i++)for(const side of [-1,1]){const p=point(i/count,side);vertices.push(p.x,p.y,p.z);}
    for(let i=0;i<count;i++){const k=start+i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
  };
  add(SAMPLES,(t,s)=>surfacePoint(t,s*(trackHalfWidthAt(t)+roadShoulderAt(t)),.052));
  add(SAMPLES,(t,s)=>surfacePoint(t,s*trackHalfWidthAt(t),.08));
  const skirt=createRoadSkirt(context),skirtStart=vertices.length/3;
  vertices.push(...skirt.vertices);for(const index of skirt.indices)indices.push(index+skirtStart);
  if(PIT.enabled) {
    add(PIT.samples,(t,s)=>{const p=pitLanePoint(t);return{x:p.x+Math.cos(p.heading)*s*(PIT.width/2+1),y:.052,z:p.z-Math.sin(p.heading)*s*(PIT.width/2+1)};});
    add(PIT.samples,(t,s)=>{const p=pitLanePoint(t);return{x:p.x+Math.cos(p.heading)*s*PIT.width/2,y:.08,z:p.z-Math.sin(p.heading)*s*PIT.width/2};});
  }
  return{vertices:new Float32Array(vertices),indices:new Uint32Array(indices)};
}

/** Road deck edge. */
export function createRoadSkirt(context:RaceTrackContext=ACTIVE_TRACK_CONTEXT):TrackSurface {
  const {TRACK_SAMPLES:SAMPLES,surfacePoint,trackHalfWidthAt,roadShoulderAt,roadHasSkirtAt,PIT,mainBarrierOpen,pitLanePoint,nearestTrack,TRACK_HALF_WIDTH}=context;
  const vertices:number[]=[],indices:number[]=[];
  for(const side of [-1,1]) {
    const start=vertices.length/3;
    for(let i=0;i<=SAMPLES;i++){const t=i/SAMPLES,p=surfacePoint(t,side*(trackHalfWidthAt(t)+roadShoulderAt(t)),.052);vertices.push(p.x,context.CURRENT_TRACK_ID==='study'?Math.max(ROOM_FLOOR_Y,p.y-.7):roadHasSkirtAt(t)?(PIT.enabled?ROOM_FLOOR_Y:-.08):p.y-.45,p.z,p.x,p.y,p.z);}
    for(let i=0;i<SAMPLES;i++){if(mainBarrierOpen((i+.5)/SAMPLES,side))continue;const k=start+i*2;if(side>0)indices.push(k,k+2,k+1,k+1,k+2,k+3);else indices.push(k,k+1,k+2,k+1,k+3,k+2);}
  }
  if(context.CURRENT_TRACK_ID==='study'){
    // Close only the deck underside, never an invisible wall down to the floor.
    const opposite=(SAMPLES+1)*2;
    for(let i=0;i<SAMPLES;i++){const a=i*2,b=a+2,c=opposite+a,d=c+2;indices.push(a,c,b,c,d,b);}
  }
  if(PIT.enabled)for(const side of [-1,1]){
    const start=vertices.length/3;
    for(let i=0;i<=PIT.samples;i++){const p=pitLanePoint(i/PIT.samples),x=p.x+Math.cos(p.heading)*side*(PIT.width/2+1),z=p.z-Math.sin(p.heading)*side*(PIT.width/2+1);vertices.push(x,ROOM_FLOOR_Y,z,x,.052,z);}
    for(let i=0;i<PIT.samples;i++){const k=start+i*2,p=pitLanePoint((i+.5)/PIT.samples);if(nearestTrack(p.x,p.z).distance<TRACK_HALF_WIDTH+PIT.width/2+1)continue;if(side>0)indices.push(k,k+2,k+1,k+1,k+2,k+3);else indices.push(k,k+1,k+2,k+1,k+3,k+2);}
  }
  return{vertices:new Float32Array(vertices),indices:new Uint32Array(indices)};
}
