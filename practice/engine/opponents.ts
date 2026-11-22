import { BaselineDrivingBot, baselineIntent, type DrivingBot, type DrivingBotView } from './driving-bot';
import { advanceStuck, STUCK_TUNE } from './stuck-detector';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createVehicle, type VehicleModel, type VehicleDesignId } from './vehicle';
import { CARS, carFor, vehicleCapabilities } from './vehicle-catalog';
import { KartPhysics, type VehicleProfile } from './physics';
import { CURRENT_TRACK_ID, trackPoint, nearestTrack, TRACK_LENGTH, TRACK_HALF_WIDTH, PIT, pitLanePoint, pitLaneNearest, startingGridSlot, BATH_ADVENTURE, trackHalfWidthAt } from './track-layout';
import { resolveVehicleGeometry } from './vehicle-geometry';
import type { TrackSurface } from './kerb-surface';
import type { RaceOptions } from './race-options';
import { RenderPose } from './render-pose';
import { drivingIntent, pitDrivingIntent, pitTransitTraffic, RaceProgress, TyreService, type TyreCompound } from './race-director';
interface Rival {number:number;streamCompound?:TyreCompound;capabilities:ReturnType<typeof vehicleCapabilities>;design:VehicleDesignId;gridSlot:number;poseHistory:RenderPose;renderRevision:number;id:string; color:number; model:VehicleModel; physics:KartPhysics; progress:RaceProgress; lane:number; gridLane:number; gridStart:number; stuck:number; recoveries:number; tyres:TyreService; passTarget:string|null; passLane:number; blocked:number; reversing:number; reverseManeuvers:number;boxIndex:number;pitState:'track'|'entry'|'service'|'exit';pitRelease:boolean;trackMergeRelease:boolean;pitYieldSeconds:number;wetUntil:number;bathRecoveryRemaining:number}
/** Fisher-Yates with a caller-owned seed. Only starting slots change; every
 * rival retains its model, paint, number, pit box and handling for the race. */
export function shuffledAiGrid(seed:number,count=7):number[]{
 const slots=Array.from({length:count},(_,i)=>i+1);let state=seed>>>0;
 for(let i=slots.length-1;i>0;i--){state=(Math.imul(state,1664525)+1013904223)>>>0;const j=Math.floor(state/4294967296*(i+1));[slots[i],slots[j]]=[slots[j],slots[i]];}
 return slots;
}
export class Opponents {
  readonly racers:Rival[]=[];
  readonly #baselineBot=new BaselineDrivingBot();
  #drivingBot:DrivingBot=this.#baselineBot;
  readonly #rivalBots=new Map<number,DrivingBot>();
  private automaticPit=true;
  setAutomaticPit(enabled:boolean){this.automaticPit=enabled;}
  setDrivingBot(bot:DrivingBot){this.#drivingBot=bot;}
  /** Assign a controller to one field index; null restores the field default. */
  setRivalDrivingBot(index:number,bot:DrivingBot|null){
    if(!Number.isInteger(index)||index<0||index>=this.racers.length)throw new RangeError('Invalid rival index');
    if(bot===null)this.#rivalBots.delete(index);else this.#rivalBots.set(index,bot);
  }
  active=false;
  private disposed=false;
  private raceSerial=0;
  private gridSeed=0;
  private previousGrid:number[]=[];
  private simulationTime=0;
  private lastStepDt=0;
  private renderedTime=0;
  private wetnessProvider:(x:number,z:number)=>number=()=>0;
  setWetnessProvider(provider:(x:number,z:number)=>number){this.wetnessProvider=provider;}
  private wetAt(x:number,z:number){const value=this.wetnessProvider(x,z);return Number.isFinite(value)?THREE.MathUtils.clamp(value,0,1):0;}
  private options:RaceOptions={mode:'solo',difficulty:'club',laps:3};
  private modelFactory:(design:VehicleDesignId,raceNumber:number)=>VehicleModel=(design,n)=>createVehicle(true,design,n);
  static async create(scene:THREE.Scene,collision:TrackSurface,seed?:number,factory?:(design:VehicleDesignId,raceNumber:number)=>VehicleModel){
    const field=new Opponents();if(factory)field.modelFactory=factory;
    field.gridSeed=seed===undefined?(globalThis.crypto?.getRandomValues(new Uint32Array(1))[0]??0x4d464149):seed>>>0;
    for(const [i,color] of [0x386777,0xb76842,0x667451,0x805ca9,0xd1a53b,0x337e70,0xac465a].entries()){
      const raceNumber=[11,24,36,48,55,62,77][i];
      const design=CARS[i%CARS.length].id;
      const model=field.modelFactory(design,raceNumber);model.root.visible=false;model.root.name=`Rival ${i+1} / ${raceNumber}`;
      // The nose, sidepods and DRS flap share each rival's number. Matching
      // suit/helmet colours provide another identity cue without HUD clutter.
      // Each original class keeps its own handling; paint changes no performance.
      model.setLivery({primary:color,secondary:[0xe4eef0,0xffe5ca,0xe7e1ba,0xe8dff3,0xffedb5,0xd8eee5,0xf2dce3][i],
        accent:[0x163b4c,0x432824,0x29382d,0x362a4e,0x3a3446,0x163e37,0x462735][i]});
      const patches=resolveVehicleGeometry(model.root.userData).wheels.map(w=>new THREE.PlaneGeometry(w.width+.12,w.radius*1.7).rotateX(-Math.PI/2).translate(w.x,.008,w.z));
      const contacts=new THREE.Mesh(mergeGeometries(patches),new THREE.ShaderMaterial({transparent:true,depthWrite:false,toneMapped:false,
        vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:'varying vec2 v;void main(){gl_FragColor=vec4(.016,.021,.024,.65*(1.-smoothstep(.16,1.,length(v*2.-1.))));}'}));
      patches.forEach(p=>p.dispose());contacts.name="wheelContacts";model.root.add(contacts);
      scene.add(model.root);
      const physics=await KartPhysics.create(collision);physics.automatedHandling=true;physics.setVehicleProfile(carFor(design).profile);physics.setVehicleGeometry(model.root.userData);model.root.userData.physicsGeometryApplied=true;
      field.racers.push({number:raceNumber,capabilities:vehicleCapabilities(design),design,gridSlot:i+1,poseHistory:new RenderPose(physics),renderRevision:physics.poseRevision,id:`rival-${i+1}`,color,model,physics,progress:new RaceProgress(),lane:(i%3-1)*.65,gridLane:0,gridStart:0,stuck:0,recoveries:0,tyres:new TyreService(),passTarget:null,passLane:0,blocked:0,reversing:0,reverseManeuvers:0,boxIndex:[1,4,6,0,2,5,7][i],pitState:'track',pitRelease:false,trackMergeRelease:false,pitYieldSeconds:0,wetUntil:0,bathRecoveryRemaining:0});
    }
    return field;
  }
  reset(options:RaceOptions,initialCompound:TyreCompound='medium',qualifyingOrder?:readonly string[]){
    this.options=options;this.active=options.mode==='race';
    this.simulationTime=this.lastStepDt=this.renderedTime=0;
    const grid=shuffledAiGrid((this.gridSeed+Math.imul(++this.raceSerial,0x9e3779b9))>>>0,this.racers.length);
    if(grid.every((slot,i)=>slot===this.previousGrid[i]))grid.push(grid.shift()!);
    this.previousGrid=grid;
    this.racers.forEach((r,i)=>{
      const qualifiedSlot=qualifyingOrder?.indexOf(r.id);
      r.gridSlot=qualifiedSlot!==undefined&&qualifiedSlot>=0?qualifiedSlot+1:grid[i];
      const p=startingGridSlot(r.gridSlot),{t,distance}=p;
      r.physics.reset(p.x,p.z,p.heading);r.physics.resetErsForRace();r.progress.reset(t,distance);r.stuck=0;r.recoveries=0;r.tyres.reset(initialCompound);r.lane=r.gridLane=p.offset;r.gridStart=distance;r.passTarget=null;r.passLane=0;r.blocked=0;r.reversing=0;r.reverseManeuvers=0;r.pitState='track';r.streamCompound=undefined;r.pitRelease=false;r.trackMergeRelease=false;r.pitYieldSeconds=0;r.wetUntil=0;r.bathRecoveryRemaining=0;
      r.poseHistory.reset(r.physics);r.renderRevision=r.physics.poseRevision;
      r.model.root.visible=this.active;this.drawPose(r,1,0);
    });
  }
  hide(){this.active=false;this.racers.forEach(r=>r.model.root.visible=false);}
  /** Explicit legacy test override; normal races never call this method. */
  private design:VehicleDesignId|null=null;
  setVehicleDesign(design:VehicleDesignId){
    if(this.design===design)return;
    const prepared:VehicleModel[]=[];
    try{for(const r of this.racers){
      const next=this.modelFactory(design,r.number);prepared.push(next);
      next.setLivery({primary:r.color,secondary:0xe4eef0,accent:0x26343c});next.setTyreCompound(r.tyres.compound);
    }}catch(error){prepared.forEach(model=>model.dispose());throw error;}
    this.design=design;
    for(const [i,r] of this.racers.entries()){
      const old=r.model, parent=old.root.parent;
      const next=prepared[i];
      next.root.visible=old.root.visible;next.root.position.copy(old.root.position);next.root.quaternion.copy(old.root.quaternion);
      next.root.name=old.root.name;const contacts=old.root.getObjectByName("wheelContacts");if(contacts instanceof THREE.Mesh){const patches=resolveVehicleGeometry(next.root.userData).wheels.map(w=>new THREE.PlaneGeometry(w.width+.12,w.radius*1.7).rotateX(-Math.PI/2).translate(w.x,.008,w.z));contacts.geometry.dispose();contacts.geometry=mergeGeometries(patches);patches.forEach(p=>p.dispose());next.root.add(contacts);}parent?.add(next.root);old.dispose();r.model=next;r.design=design;r.capabilities=vehicleCapabilities(design);r.physics.setVehicleProfile(carFor(design).profile);r.physics.reset(r.physics.position.x,r.physics.position.z,r.physics.heading);r.physics.setVehicleGeometry(next.root.userData);next.root.userData.physicsGeometryApplied=true;
    }
  }
  setVehicleProfile(profile:Partial<VehicleProfile>={}){for(const rival of this.racers)rival.physics.setVehicleProfile(profile);}
  traffic(){return this.active?this.racers.map(r=>({id:r.id,x:r.physics.position.x,y:r.physics.position.y,z:r.physics.position.z,heading:r.physics.heading,pitch:r.physics.pitch,roll:r.physics.roll,pitProtected:r.physics.pitProtectionActive,ghost:r.physics.ghostSeconds>0,speed:r.physics.speed,geometry:r.physics.vehicleGeometry})):[];}
  step(dt:number,time:number,player:KartPhysics|null){
    if(!this.active)return;
    this.simulationTime+=dt;this.lastStepDt=dt;
    const traffic=[...(player?[{id:'player',x:player.position.x,y:player.position.y,z:player.position.z,heading:player.heading,pitch:player.pitch,roll:player.roll,pitProtected:player.pitProtectionActive,ghost:player.ghostSeconds>0,speed:player.speed,geometry:player.vehicleGeometry}]:[]),...this.traffic()];
    const reservedLanes=new Map(this.racers.map(r=>[r.id,r.passTarget?r.passLane:r.lane]));
    // Query only nearby traffic, memoized against immutable start-of-step poses.
    const trafficRoads=new Map<string,ReturnType<typeof nearestTrack>>();
    for(const [i,r]of this.racers.entries()){
      const p=r.physics,n=nearestTrack(p.position.x,p.position.z,p.position.y);
      if(!r.capabilities.drs)p.drsOpen=0;
      p.ersAllowed=r.capabilities.ers&&r.pitState==='track'&&r.bathRecoveryRemaining===0&&r.progress.finishedAt===null;
      if(BATH_ADVENTURE.enabled&&r.bathRecoveryRemaining===0&&BATH_ADVENTURE.waterContains(p.position.x,p.position.z)&&p.position.y<BATH_ADVENTURE.waterY+.25){
        // Match the player's 1.15s splash and .35s checkpoint recovery. Race
        // time continues outside this loop; there is no instant AI shortcut.
        r.bathRecoveryRemaining=1.5;r.passTarget=null;r.lane=0;r.reversing=0;r.stuck=0;p.drsOpen=0;
      }
      if(r.bathRecoveryRemaining>0){
        p.ersAllowed=false;
        const before=r.bathRecoveryRemaining;
        r.bathRecoveryRemaining=Math.max(0,before-dt);
        if(r.bathRecoveryRemaining<1e-9)r.bathRecoveryRemaining=0;
        p.setTraffic([]);p.step(dt,{throttle:0,brake:1,steer:0,drift:false});
        if(before>.35&&r.bathRecoveryRemaining<=.35+1e-9){
          r.bathRecoveryRemaining=Math.min(.35,r.bathRecoveryRemaining);
          // Reset to the ground checkpoint and debit all skipped climb/rim
          // progress. The remaining .35s is a neutral-input ground hold.
          const t=BATH_ADVENTURE.checkpointT,back=trackPoint(t),retreat=(r.progress.legalT-t+1)%1;
          p.reset(back.x,back.z,back.heading,back.y+.08);r.progress.distance-=retreat;r.progress.t=r.progress.legalT=t;r.recoveries++;
        }
        this.capturePose(r);continue;
      }
      const adventureAhead=BATH_ADVENTURE.enabled&&n.t>=BATH_ADVENTURE.approachT-25/TRACK_LENGTH&&n.t<=BATH_ADVENTURE.endT;

      const nearby=p.ghostSeconds>0?[]:traffic.filter(c=>!c.ghost&&c.id!==r.id&&Math.abs(c.y-p.position.y)<4);
      const wetness=this.wetAt(p.position.x,p.position.z);
      // Inspect the road ahead before crossing a puddle; tyre strategy keeps a
      // memory of rain so a short dry patch does not trigger a dry-tyre stop.
      let previewWet=wetness;
      for(const d of [8,18,32,48]){const at=trackPoint(n.t+d/TRACK_LENGTH);previewWet=Math.max(previewWet,this.wetAt(at.x,at.z));}
      if(previewWet>.25)r.wetUntil=time+90;
      if(r.streamCompound)r.tyres.selectCompound(r.streamCompound);
      else if(time<r.wetUntil&&r.tyres.compound!=='wet'){r.tyres.selectCompound('wet');r.tyres.requested=true;}
      else if(time>=r.wetUntil&&r.tyres.compound==='wet'){r.tyres.selectCompound('medium');r.tyres.requested=true;}
      if(this.automaticPit&&PIT.enabled&&r.tyres.wear>.45&&r.progress.finishedAt===null)r.tyres.requested=true;
      let toEntry=PIT.entryT-n.t;if(toEntry<0)toEntry++;
      if(PIT.enabled&&r.tyres.requested&&r.pitState==='track'&&toEntry*TRACK_LENGTH<Math.max(26,p.speed*p.speed/48+8)){r.pitState='entry';r.passTarget=null;r.reversing=0;r.pitRelease=false;r.trackMergeRelease=false;}
      p.pitProtected=r.pitState!=='track';
      if(r.pitState!=='track'){
        r.stuck=0;
        p.ersAllowed=false;
        const box=PIT.boxes[r.boxIndex],pit=pitLaneNearest(p.position.x,p.position.z);
        const sample=(u:number)=>{
          const at=pitLanePoint(u),smooth=(x:number)=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
          const edge=smooth((at.x-PIT.entry.x)/18)*smooth((PIT.exit.x-at.x)/18);
          const into=smooth((at.x-(box.x-14))/11),out=smooth((at.x-(box.x+1))/12);
          const lane=(1.5-3*into*(1-out))*edge;
          return{...at,x:at.x+Math.cos(at.heading)*lane,z:at.z-Math.sin(at.heading)*lane};
        };
        const serviced=r.tyres.update(dt,p.speed,p.slip,PIT.inBox(p.position.x,p.position.z,r.boxIndex),wetness);
        if(serviced==='started')r.pitState='service';if(serviced==='complete'){r.pitState='exit';r.streamCompound=undefined;}
        let stopAt:{x:number;z:number}|undefined=r.pitState==='exit'?undefined:box;
        // Same protected, immediate-release rule as human drivers. Assigned
        // service time remains equal; neither bay exit nor merge waits for cars.
        if(r.pitState==='exit'){r.pitRelease=true;r.trackMergeRelease=true;}
        const state={x:p.position.x,z:p.position.z,heading:p.heading,speed:p.speed,t:pit.u,steeringLimit:p.steeringRange,wheelBase:p.vehicleGeometry.wheelbase};
        const intent=pitDrivingIntent(state,sample,pit.u,stopAt,pitTransitTraffic(state,nearby,pitLaneNearest));
        // The pit approach begins before the preceding main-road bend has
        // ended. Brake for the pit now, but follow that actual bend until the
        // entry tangent; aiming directly at its first point cuts the inner rail.
        if(r.pitState==='entry'&&toEntry<.05&&toEntry*TRACK_LENGTH>3){
          const approach=drivingIntent({x:p.position.x,z:p.position.z,heading:p.heading,speed:p.speed,t:n.t,steeringLimit:p.steeringRange,wheelBase:p.vehicleGeometry.wheelbase},trackPoint,TRACK_LENGTH,1,0,nearby);
          intent.steer=approach.steer;
          if(approach.target<intent.target){intent.target=approach.target;intent.throttle=approach.throttle;intent.brake=approach.brake;}
          // On the last curved approach, local forward projection can mistake
          // the next car for a separate lane. Reserve its arc-length spacing.
          for(const car of nearby){
            const road=nearestTrack(car.x,car.z,car.y);let gap=(road.t-n.t)*TRACK_LENGTH;
            if(gap< -TRACK_LENGTH/2)gap+=TRACK_LENGTH;
            if(gap>0&&gap<32&&road.distance<3&&Math.abs(road.signedDistance-n.signedDistance)<2.5){
              const safe=Math.max(0,car.speed+(gap-6.2)*1.2);
              if(safe<intent.target){intent.target=safe;intent.throttle=THREE.MathUtils.clamp((safe-p.speed)*.8,0,1);intent.brake=safe===0?1:THREE.MathUtils.clamp((p.speed-safe)*.45,0,1);}
            }
          }
        }
        if(wetness>.01){const safe=intent.target*Math.sqrt(r.tyres.gripFor(wetness))*.80;intent.target=safe;intent.throttle=THREE.MathUtils.clamp((safe-p.speed)*.8,0,1);intent.brake=safe===0?1:THREE.MathUtils.clamp((p.speed-safe)*.45,0,1);}
        p.drsOpen=0;p.gripMultiplier=r.tyres.gripFor(wetness);p.setTraffic(nearby);p.step(dt,intent);
        const after=nearestTrack(p.position.x,p.position.z,p.position.y);
        r.progress.advance(after.t,PIT.contains(p.position.x,p.position.z)||after.distance<TRACK_HALF_WIDTH+.35,dt,p.speed,TRACK_LENGTH);
        if(r.progress.distance>=this.options.laps&&r.progress.finishedAt===null)r.progress.finishedAt=time;
        if(r.pitState==='exit'&&pit.u>.998&&after.distance<TRACK_HALF_WIDTH){r.pitState='track';p.pitProtected=false;r.lane=0;}
        this.capturePose(r);continue;
      }
      // Choose a passing line before entering the braking distance. Road
      // distance stays stable while the car turns sideways to start a pass.
      const along=(t:number)=>{let d=t-n.t;if(d<-.5)d++;if(d>.5)d--;return d*TRACK_LENGTH;};
      const planned=nearby.map(car=>{let road=trafficRoads.get(car.id);if(!road){road=nearestTrack(car.x,car.z,car.y);trafficRoads.set(car.id,road);}return {car,road};});
      // A car entering the pit sweeps across the south-side passing line.
      // Follow it through the junction instead of attempting an inside pass
      // while it is braking and turning out of the main road.
      const enteringAhead=planned.some(c=>along(c.road.t)>-3&&along(c.road.t)<45&&this.racers.some(other=>other.id===c.car.id&&other.pitState==='entry')&&c.road.distance<3.5);
      if(enteringAhead||adventureAhead)r.passTarget=null;
      // Faster cars need time to establish lateral clearance before traffic
      // braking reaches a standstill; keep that reservation through the pass.
      const passPreview=Math.max(24,Math.abs(p.speed)*1.05);
      const committed=planned.find(c=>c.car.id===r.passTarget);
      if(committed&&(along(committed.road.t)<-5.5||along(committed.road.t)>passPreview+6||
        (along(committed.road.t)>6&&committed.car.speed>5&&committed.car.speed>p.speed-1))){
        // A moving target may accelerate away while a second, stopped car is
        // still alongside us. Reserve the established passing side until the
        // entire return corridor is clear, not merely the original target.
        // Otherwise the normal line can pull our rear wheel into that car.
        const returnBlocked=Math.abs(r.lane)>1.5?planned.find(c=>along(c.road.t)>-6.5&&along(c.road.t)<12&&Math.abs(c.road.signedDistance-(i%3-1)*.65)<1.85):undefined;
        r.passTarget=returnBlocked?.car.id??null;
      }
      const headingChange=(distance:number)=>{const d=trackPoint(n.t+distance/TRACK_LENGTH).heading-n.heading;return Math.abs(Math.atan2(Math.sin(d),Math.cos(d)));};
      const passingStraight=headingChange(5)<.12&&headingChange(12)<.12&&headingChange(24)<.12;
      // Corner braking is not an invitation to dive beside a rival where both
      // racing lines must converge. A moving overtake needs clear straight road.
      // A car accelerating out of its grid slot is not a stopped obstacle.
      // Keep launch corridors while the field gets moving; a genuinely
      // stalled car can still be passed once that brief start phase ends.
      // A moving pass needs enough straight to clear both long cars before
      // the braking zone; merely being on a straight for the next 24u is not enough.
      const slowAhead=time<2||enteringAhead||adventureAhead?undefined:planned.find(c=>along(c.road.t)>0&&along(c.road.t)<passPreview&&Math.abs(c.road.signedDistance-n.signedDistance)<1.9&&
        (c.car.speed<2||(passingStraight&&headingChange(Math.max(48,p.speed*2))<.12&&c.car.speed<p.speed-4)));
      // Keep staggered launch corridors for 40u before a gradual 25u merge.
      // Rivals must not cut across one another as the lights go out.
      const launchBlend=THREE.MathUtils.smoothstep((r.progress.distance-r.gridStart)*TRACK_LENGTH,40,65);
      let desiredLane=adventureAhead?0:THREE.MathUtils.lerp(r.gridLane,(i%3-1)*.65,launchBlend);
      if(!r.passTarget&&slowAhead){
        const otherOffset=slowAhead.road.signedDistance;
        const sameSide=Math.abs(n.signedDistance)>.45?Math.sign(n.signedDistance):(i%2===0?1:-1);
        const preferred=Math.abs(otherOffset)<.35?sameSide*2.05:otherOffset>0?-2.05:2.05;
        // Reserve a complete crossing corridor before leaving our established
        // lane. A following car cannot choose the same gap as a car alongside.
        const available=(lane:number)=>planned.every(c=>{
          if(c.car.id===slowAhead.car.id)return Math.abs(lane-c.road.signedDistance)>1.95;
          const gap=along(c.road.t);if(gap<=-5.5||gap>=12)return true;
          const from=Math.min(n.signedDistance,lane)-1.85,to=Math.max(n.signedDistance,lane)+1.85;
          const occupied=c.road.signedDistance,plannedLane=reservedLanes.get(c.car.id)??occupied;
          // A rear car must not reserve the space on the opposite side of
          // our nose. Moving away from its current AND planned line opens
          // clearance; rejecting that move can deadlock an entire queue.
          const opensRearClearance=gap<0&&[occupied,plannedLane].every(offset=>
            (lane-offset)*(n.signedDistance-offset)>0&&Math.abs(lane-offset)>Math.abs(n.signedDistance-offset));
          return opensRearClearance||(occupied<from&&plannedLane<from)||(occupied>to&&plannedLane>to);
        });
        const candidate=[preferred,-preferred].find(available);
        if(candidate!==undefined){r.passTarget=slowAhead.car.id;r.passLane=candidate;}
      }
      if(r.passTarget)desiredLane=r.passLane;
      else if(planned.some(c=>{
        const gap=along(c.road.t);if(Math.abs(gap)>7)return false;
        const from=Math.min(n.signedDistance,desiredLane)-1.85,to=Math.max(n.signedDistance,desiredLane)+1.85;
        return c.road.signedDistance>from&&c.road.signedDistance<to;
      }))desiredLane=r.lane;
      r.lane+=(desiredLane-r.lane)*(1-Math.exp(-dt*(r.passTarget?10:2.5)));
      const view:DrivingBotView=Object.freeze({x:p.position.x,y:p.position.y,z:p.position.z,heading:p.heading,speed:p.speed,t:n.t,distance:r.progress.distance,steeringLimit:p.steeringRange,wheelBase:p.vehicleGeometry.wheelbase,lane:r.lane,difficulty:this.options.difficulty,rivalIndex:i,seed:this.gridSeed,dt,time,wetness,previewWet,tyreGrip:r.tyres.gripFor(previewWet),tyreCompound:r.tyres.compound,ersEnergy:p.ers.energy,ersAllowed:p.ersAllowed,
        traffic:Object.freeze(nearby.map(c=>Object.freeze({id:c.id,x:c.x,z:c.z,speed:c.speed,heading:c.heading}))),
        track:Object.freeze({id:CURRENT_TRACK_ID,length:TRACK_LENGTH,halfWidth:TRACK_HALF_WIDTH,point:(t:number)=>Object.freeze({...trackPoint(t)}),nearest:(x:number,z:number,y?:number)=>Object.freeze({...nearestTrack(x,z,y)})})});
      const bot=this.#rivalBots.get(i)??this.#drivingBot;
      const baseline=bot===this.#baselineBot;
      const raw=bot.tick(view);
      const finite=(v:number,min:number,max:number)=>Number.isFinite(v)?THREE.MathUtils.clamp(v,min,max):0;
      // Legacy control metadata is engine-owned; unknown bot fields cannot alter physics.
      let intent={throttle:finite(raw.throttle,0,1),brake:finite(raw.brake,0,1),steer:finite(raw.steer,-1,1),drift:false,automated:true,target:baseline?baselineIntent(view).target:0};
      // A packed field converges at the apex. Use road distance to brake for
      // the next car, even when a curved approach puts it outside the narrow
      // forward-facing traffic cone. Preserve passing room on straight road.
      if(baseline){
        for(const c of planned){
          // The target of an established straight pass is already handled by
          // local-heading clearance in drivingIntent. An arc-distance stop here
          // would prevent the final lateral steering movement around its nose.
          if(passingStraight&&c.car.id===r.passTarget)continue;
          const gap=along(c.road.t),otherLane=reservedLanes.get(c.car.id)??c.road.signedDistance;
          const currentOverlap=Math.abs(c.road.signedDistance-n.signedDistance)<(passingStraight?1.95:3.2);
          const futureOverlap=Math.abs(otherLane-r.lane)<1.95;
          if(gap>0&&gap<Math.max(24,p.speed*1.5)&&c.road.distance<trackHalfWidthAt(c.road.t)&&(currentOverlap||futureOverlap)){
            const safe=Math.max(0,c.car.speed+(gap-7.5)*1.0);
            if(safe<intent.target){intent.target=safe;intent.throttle=THREE.MathUtils.clamp((safe-p.speed)*.65,0,1);intent.brake=THREE.MathUtils.clamp((p.speed-safe)*.45,0,1);}
          }
        }
        if(adventureAhead){
          const rimSoon=n.t>=BATH_ADVENTURE.entryT-30/TRACK_LENGTH&&n.t<=BATH_ADVENTURE.exitT+12/TRACK_LENGTH;
          intent.target=Math.min(intent.target,rimSoon?19:24);
          intent.throttle=THREE.MathUtils.clamp((intent.target-p.speed)*.65,0,1);
          intent.brake=THREE.MathUtils.clamp((p.speed-intent.target)*.3,0,1);
        }
        // A very late encounter can stop before there is enough room to steer.
        // Open real space behind the car; never translate through an obstacle.
        const rearBlocked=nearby.some(c=>{const dx=c.x-p.position.x,dz=c.z-p.position.z;
          const ahead=dx*Math.sin(p.heading)+dz*Math.cos(p.heading),side=dx*Math.cos(p.heading)-dz*Math.sin(p.heading);
          return ahead<0&&ahead>-5.3&&Math.abs(side)<1.95;});
        r.blocked=Math.abs(p.speed)<.45&&!!r.passTarget&&intent.target<.2?r.blocked+dt:0;
        // Resolve the external obstruction at the front first; queued AI must
        // follow that manoeuvre rather than reverse into the rest of the field.
        if(r.blocked>1.1&&!rearBlocked&&r.reversing===0&&r.passTarget==='player'){r.reversing=1.5;r.reverseManeuvers++;r.blocked=0;}
        if(r.reversing>0){
          const headingError=Math.atan2(Math.sin(p.heading-n.heading),Math.cos(p.heading-n.heading));
          intent={throttle:rearBlocked?0:Math.max(-.7,Math.min(0,(-2.6-p.speed)*.7)),brake:rearBlocked?1:0,
            steer:Math.max(-.5,Math.min(.5,headingError*2)),drift:false,automated:true,target:-2.6};
          r.reversing=rearBlocked?0:Math.max(0,r.reversing-dt);
        }
      }
      r.tyres.update(dt,p.speed,p.slip,false,wetness);p.gripMultiplier=r.tyres.gripFor(wetness);
      p.setTraffic(nearby);
      // Rivals spend the same finite battery on clear exits; no extra charge
      // or speed multiplier. Tight bends, traffic braking and recovery suppress it.
      const boost=baseline&&p.ersAllowed&&!adventureAhead&&r.reversing===0&&intent.throttle>.8&&intent.brake===0&&Math.abs(intent.steer)<.2&&p.speed>10&&p.ers.energy>.12&&passingStraight;
      p.step(dt,{throttle:intent.throttle,brake:intent.brake,steer:intent.steer,drift:false,automated:true,boost}); // A finished rival keeps circulating; it must not block the finish line.
      const after=nearestTrack(p.position.x,p.position.z,p.position.y);
      const onRoad=after.distance<trackHalfWidthAt(after.t)+.3&&Math.abs(p.position.y-(after.y??0)-.08)<.7;
      r.progress.advance(after.t,onRoad,dt,p.speed,TRACK_LENGTH);
      if(r.progress.distance>=this.options.laps&&r.progress.finishedAt===null)r.progress.finishedAt=time;
      const stuck=advanceStuck(r.stuck,dt,{speed:p.planarSpeed,throttle:intent.throttle,barrier:p.barrierContact,offTrack:!onRoad,
        pit:r.pitState!=='track'||r.tyres.servicing,bathAdventure:adventureAhead||r.bathRecoveryRemaining>0,
        finished:r.progress.finishedAt!==null,online:p.networkHandling,ghost:p.ghostSeconds>0});
      r.stuck=stuck.seconds;
      // Recovery is a visible time loss, not rubber banding forward to the player.
      if(stuck.reset){
        if(BATH_ADVENTURE.enabled&&r.progress.legalT>=BATH_ADVENTURE.approachT&&r.progress.legalT<=BATH_ADVENTURE.endT){
          // Off the outside edge / stalled on the ramp uses the same delay,
          // so the generic unstuck path cannot bypass the water time penalty.
          r.bathRecoveryRemaining=1.5;r.passTarget=null;r.lane=0;r.reversing=0;r.stuck=0;p.drsOpen=0;
          this.capturePose(r);continue;
        }
        const back=trackPoint(r.progress.legalT);p.reset(back.x,back.z,back.heading,back.y+.08);r.progress.t=r.progress.legalT;p.ghostSeconds=STUCK_TUNE.ghostSeconds;r.stuck=0;r.recoveries++;
      }
      this.capturePose(r);
    }
  }
  /** Explicit visual restore (for example after replay), never a physics step. */
  pose(r:Rival,dt:number){
    r.poseHistory.reset(r.physics);r.renderRevision=r.physics.poseRevision;this.drawPose(r,1,dt);
  }
  private capturePose(r:Rival){
    // RenderPose detects physics reset/grounding revisions and discontinuities,
    // so neither checkpoint resets nor short recovery moves are interpolated.
    r.poseHistory.push(r.physics);r.renderRevision=r.physics.poseRevision;
  }
  private drawPose(r:Rival,alpha:number,dt:number){
    if(r.renderRevision!==r.physics.poseRevision){
      r.poseHistory.reset(r.physics);r.renderRevision=r.physics.poseRevision;
    }
    const pose=r.poseHistory.sample(alpha);
    r.model.root.position.set(pose.x,pose.y,pose.z);
    r.model.root.rotation.set(-pose.pitch,pose.heading,pose.roll,'YXZ');
    r.model.update(r.physics.speed,r.physics.steer,dt,r.physics.drsOpen,pose.wheels,r.physics.steeringAngle);
  }
  /** Call once per display frame, after all fixed physics steps, with
   * accumulator / fixedDt. Does not advance simulation, traffic or race time.
   * Animation advances on that interpolated clock, so pause/repeated renders
   * do not spin wheels and multiple physics steps never multiply visual speed.
   */
  render(alpha:number){
    if(!this.active)return;
    const fraction=Number.isFinite(alpha)?THREE.MathUtils.clamp(alpha,0,1):0;
    const time=Math.max(0,this.simulationTime-this.lastStepDt*(1-fraction));
    const dt=THREE.MathUtils.clamp(time-this.renderedTime,0,.1);
    this.renderedTime=Math.max(this.renderedTime,time);
    for(const r of this.racers)this.drawPose(r,fraction,dt);
  }
  position(playerProgress:number,finishTime?:number){let place=1;for(const r of this.racers)if(r.progress.finishedAt!==null?(finishTime===undefined||r.progress.finishedAt<finishTime):r.progress.distance>playerProgress)place++;return place;}
  snapshot(){return this.racers.map(r=>({id:r.id,design:r.design,gridSlot:r.gridSlot,heading:r.physics.heading,lane:r.lane,t:r.progress.t,progress:r.progress.distance,position:{...r.physics.position},speed:r.physics.speed,drsOpen:r.physics.drsOpen,finishedAt:r.progress.finishedAt,collisions:r.physics.collisionCount,recoveries:r.recoveries,bathRecoveryRemaining:r.bathRecoveryRemaining,reverseManeuvers:r.reverseManeuvers,tyreWear:r.tyres.wear,compound:r.tyres.compound,selectedCompound:r.tyres.selectedCompound,pitState:r.pitState,boxIndex:r.boxIndex,requested:r.tyres.requested,servicing:r.tyres.servicing,serviceRemaining:r.tyres.remaining,pitStops:r.tyres.stops,pitYieldSeconds:r.pitYieldSeconds}));}
  dispose(){
    if(this.disposed)return;this.disposed=true;this.active=false;
    this.racers.forEach(r=>{r.physics.dispose();r.model.dispose();});
  }
}
