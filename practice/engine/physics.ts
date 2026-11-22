import * as THREE from 'three';
import { ErsSystem } from './ers';
import RAPIER from '@dimforge/rapier3d-compat';
import type { TrackBarrier } from './track';
import { ACTIVE_TRACK_CONTEXT, ROOM_HALF_WIDTH, ROOM_HALF_DEPTH, ROOM_FLOOR_Y, type RaceTrackContext } from './track-layout';
import { MAX_SPEED, LEGACY_ROAD_PACE, HANDLING_PACE_SCALE, HANDLING_TUNE, steeringLimit, formulaAero } from './handling';
import { VEHICLE_SPEC as SPEC } from './vehicle-spec';
import {DEFAULT_VEHICLE_GEOMETRY,resolveVehicleGeometry,chassisVertices,geometryInertia,geometryAckermann,type VehicleGeometry} from './vehicle-geometry';
import type { VehicleProfile } from './vehicle-catalog';
export type { VehicleProfile } from './vehicle-catalog';
import { createKerbSurface, createRoadSurface, type TrackSurface } from './kerb-surface';

/** Session-owned immutable inputs; each driver still owns its Rapier world. */
export interface PhysicsTrackSurfaces {
 readonly context: RaceTrackContext;
 readonly road?: TrackSurface;
 readonly kerb: TrackSurface;
}
export function preparePhysicsTrack(context: RaceTrackContext): PhysicsTrackSurfaces {
 return {context, road:context.IS_GRAND_PRIX?createRoadSurface(context):undefined,kerb:createKerbSurface(context)};
}

export interface KartInput { throttle: number; brake: number; steer: number; drift: boolean; boost?: boolean; /** Closed-loop road/pit driver, calibrated for the original response. */ automated?: boolean }
export interface TrafficCar {id:string; x:number;y:number;z:number;heading:number;pitch?:number;roll?:number;pitProtected?:boolean;ghost?:boolean;geometry?:VehicleGeometry}
const BASE_PROFILE:Required<VehicleProfile>={engineScale:1,dragScale:1,downforceScale:1,gripScale:1,steerScale:1,
 topSpeedScale:1,brakeScale:1,responseScale:1,rearGripScale:1,handbrakeGrip:1,suspensionDampingScale:1,drs:true,ers:true};

const DT = 1 / 60;
const MASS = 0.65;
const SURFACE_Y = 0.08;
const CHASSIS_OFFSET = 0.42;

const WHEEL_RADIUS = SPEC.wheelRadius;
const SUSPENSION_REST = 0.22;
const SUSPENSION_TRAVEL = 0.19;
// More rebound control without changing spring travel or the static ride
// height. Contacts still follow the actual road/kerb mesh independently.
const SUSPENSION_DAMPING = 7.2;
const down = { x: 0, y: -1, z: 0 };
let rapierReady: Promise<void> | null = null;
const WHEELS=[[-SPEC.frontWheelX,SPEC.frontAxleZ,SPEC.frontTyreWidth],[SPEC.frontWheelX,SPEC.frontAxleZ,SPEC.frontTyreWidth],
  [-SPEC.rearWheelX,SPEC.rearAxleZ,SPEC.rearTyreWidth],[SPEC.rearWheelX,SPEC.rearAxleZ,SPEC.rearTyreWidth]] as const;
function chassisShape(geometry:VehicleGeometry=DEFAULT_VEHICLE_GEOMETRY){return RAPIER.ColliderDesc.convexHull(chassisVertices(geometry))!;}

/** Physically simulated miniature racer. Position is the visual ground reference. */
export class KartPhysics {
  readonly position = new THREE.Vector3(0, SURFACE_Y, -11);
  heading = Math.PI / 2;
  speed = 0;
  steer = 0;
  steeringSensitivity = 1;
  /** Closed-loop drivers retain their calibrated steering envelope. */
  automatedHandling = false;
  /** Fixed protocol revision retains its original pace/steering/tyre model. */
  networkHandling = false;
  private get paceRatio(){return LEGACY_ROAD_PACE / 3.5;}
  private get enginePace(){return this.paceRatio ** 2 * (this.networkHandling ? 1 : HANDLING_PACE_SCALE);}
  private get topSpeed(){return this.networkHandling ? 48 * this.paceRatio : MAX_SPEED;}
  // Human ease-in adds too much phase lag to the road/pit feedback controller.
  // Keep its calibrated response; network mode always uses the original rates.
  private steeringRate(target:number,automated=false){const original=this.networkHandling||automated;return (Math.abs(target)<.01 ? (original?20:HANDLING_TUNE.steeringReturnRate) : (original?15:HANDLING_TUNE.steeringApplyRate));}
  slip = 0;
  pitch = 0;
  roll = 0;
  gripMultiplier = 1;
  drsOpen = 0;
  steeringAngle = 0;
  private readonly ersSystem=new ErsSystem();
  /** Public display state; only the local/authoritative physics updates it. */
  readonly ers=this.ersSystem.telemetry;
  private allowErs=true;
  get ersAllowed(){return this.allowErs&&this.profile.ers;}
  set ersAllowed(value:boolean){this.allowErs=value===true;if(!this.allowErs)this.ersSystem.cancel();}
  /** Call only at the start of a new race, never on recovery or pit service. */
  resetErsForRace(){this.ersSystem.resetRace();}
  /** Actual wheel-centre heights in visual-root coordinates: FL,FR,RL,RR. */
  readonly wheelHeights:number[]=[WHEEL_RADIUS,WHEEL_RADIUS,WHEEL_RADIUS,WHEEL_RADIUS];
  /** Set only by the local/server pit controller, never accepted as input. */
  pitProtected = false;
  ghostSeconds = 0;
  barrierContact = false;
  collisionCount = 0;
  /** Monotonic discontinuity marker for render interpolation, including resets. */
  poseRevision = 0;
  /** Exceptional invalid-state repairs; no forward race progress is supplied. */
  groundingRecoveries = 0;

  private readonly world: RAPIER.World;
  private readonly body: RAPIER.RigidBody;
  private readonly chassis: RAPIER.Collider;
  private readonly floor: RAPIER.Collider;
  private readonly kerb: RAPIER.Collider;
  private readonly road?: RAPIER.Collider;
  private readonly spatial: boolean;
  private readonly track: RaceTrackContext;
  private readonly traffic = new Map<string,{body:RAPIER.RigidBody;collider:RAPIER.Collider;suppressed:boolean;geometry:VehicleGeometry}>();
  private readonly events = new RAPIER.EventQueue(true);
  private geometry=DEFAULT_VEHICLE_GEOMETRY;
  private wheelShapes = WHEELS.map(([, ,width])=>new RAPIER.RoundCylinder(width/2-.018,WHEEL_RADIUS-.018,.018));
  private readonly barrierHandles = new Set<number>();
  private accumulator = 0;
  private impactCooldown = 0;
  private buriedSeconds = 0;
  private edgePinnedSeconds = 0;
  private edgeReleaseSeconds = 0;
  private disposed = false;
  private profile:Required<VehicleProfile>={...BASE_PROFILE};

  static async create(barriers: TrackBarrier[] | TrackSurface, context:RaceTrackContext=ACTIVE_TRACK_CONTEXT, surfaces?:PhysicsTrackSurfaces): Promise<KartPhysics> {
    rapierReady ??= RAPIER.init();
    await rapierReady;
    if(surfaces&&surfaces.context!==context)throw new Error('Physics surfaces belong to another track');
    return new KartPhysics(barriers,context,surfaces);
  }

  private constructor(barriers: TrackBarrier[] | TrackSurface, context:RaceTrackContext, surfaces?:PhysicsTrackSurfaces) {
    this.track=context;this.spatial=context.IS_GRAND_PRIX;
    // Calibrated miniature dynamics. Room enlargement changes the course,
    // not wheel springs, mass, engine forces or solver tolerances.
    this.world = new RAPIER.World({ x: 0, y: -98.1, z: 0 });
    this.world.lengthUnit = 10;
    // Speculative contacts on curved, thin closed meshes can lock a reversing
    // chassis before real contact (including above the kerb). Use exact contact
    // generation here; continuous collision detection still sweeps fast motion.
    // Regression coverage includes both walls, seams, and reverse escape.
    this.world.integrationParameters.normalizedPredictionDistance = 0;
    this.world.integrationParameters.normalizedAllowedLinearError = .0001;
    this.world.timestep = DT;
    this.world.numSolverIterations = 8;
    this.floor = this.world.createCollider(RAPIER.ColliderDesc.cuboid(this.spatial?ROOM_HALF_WIDTH:36, 0.15, this.spatial?ROOM_HALF_DEPTH:32)
      .setTranslation(0, (this.spatial?ROOM_FLOOR_Y:SURFACE_Y) - 0.15, 0).setFriction(0.3).setRestitution(0));
    if(this.spatial) {
      const road=surfaces?.road??createRoadSurface(context);
      this.road=this.world.createCollider(RAPIER.ColliderDesc.trimesh(road.vertices,road.indices,RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(.6).setRestitution(0));
    }
    const kerb = surfaces?.kerb??createKerbSurface(context);
    this.kerb = this.world.createCollider(RAPIER.ColliderDesc.trimesh(kerb.vertices, kerb.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(.6).setRestitution(0));
    if (!Array.isArray(barriers)) {
      const wall = this.world.createCollider(RAPIER.ColliderDesc.trimesh(barriers.vertices, barriers.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
        .setFriction(.025).setRestitution(.04));
      this.barrierHandles.add(wall.handle);
    }
    for (const barrier of Array.isArray(barriers) ? barriers : []) {
      const half = barrier.rotation / 2;
      const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(barrier.hx, 0.30, barrier.hz)
        .setTranslation(barrier.x, (barrier.y??SURFACE_Y) + 0.30, barrier.z)
        .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) })
        .setFriction(0.15).setRestitution(0.10));
      this.barrierHandles.add(collider.handle);
    }
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, SURFACE_Y + CHASSIS_OFFSET, -11)
      .setLinearDamping(0.02).setAngularDamping(0.6).setCcdEnabled(true)
      .enabledRotations(this.spatial, true, this.spatial).setCanSleep(false));
    this.chassis = this.world.createCollider(chassisShape()
      // Wings belong to the collision envelope, not the mass distribution.
      // A volume-derived off-centre mass otherwise tilted the resting car and
      // turned suspension force into an unintended backward propulsion force.
      .setMassProperties(MASS,{x:0,y:0,z:0},{x:MASS/3*(.18**2+SPEC.chassisHalfLength**2),
        y:MASS/3*(SPEC.chassisHalfWidth**2+SPEC.chassisHalfLength**2),z:MASS/3*(SPEC.chassisHalfWidth**2+.18**2)},{x:0,y:0,z:0,w:1})
      .setFriction(.02).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(0.08)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), this.body);
    this.reset();
    // Populate the spatial query pipeline before the first suspension sweep.
    this.world.step(this.events);
    this.syncState();
  }

  /** Protection is geometrically confined even if a controller flag is stale.
   * It covers entry/transit/merge only; ordinary road racing stays solid. */
  private inPitProtectionZone(p:{x:number;y:number;z:number}){
    const {PIT,pitLaneNearest}=this.track;
    if(!PIT.enabled||p.y<-.7||p.y>1.2||p.x<PIT.entry.x-3||p.x>PIT.exit.x+3)return false;
    return pitLaneNearest(p.x,p.z).distance<4.25;
  }
  get pitProtectionActive(){return this.pitProtected&&this.inPitProtectionZone(this.position);}

  get bodyCount(): number { return this.disposed ? 0 : this.world.bodies.len(); }
  get colliderCount(): number { return this.disposed ? 0 : this.world.colliders.len(); }
  get planarSpeed(){const v=this.body.linvel();return Math.hypot(v.x,v.z);}
  get steeringRange(){return steeringLimit(this.speed,this.networkHandling,this.automatedHandling)*this.profile.steerScale;}
  get aeroState(){return this.aeroForSpeed(this.speed);}
  private aeroForSpeed(speed:number){const a=formulaAero(speed,this.spatial&&this.profile.drs?this.drsOpen:0);return{
    drag:a.drag*this.profile.dragScale/(this.networkHandling?1:HANDLING_PACE_SCALE),frontLoad:a.frontLoad*this.profile.downforceScale,rearLoad:a.rearLoad*this.profile.downforceScale};}
  setVehicleProfile(profile:Partial<VehicleProfile>={}){
    const bounds={engineScale:[.9,1.12],dragScale:[.8,1.15],downforceScale:[.06,1.35],gripScale:[.93,1.06],steerScale:[.9,1.08],
      topSpeedScale:[.75,1],brakeScale:[.75,1.1],responseScale:[.75,1.25],rearGripScale:[.9,1.1],handbrakeGrip:[.25,1],suspensionDampingScale:[.8,1.2]};
    for(const key of Object.keys(bounds) as (keyof typeof bounds)[]){const value=profile[key];this.profile[key]=Number.isFinite(value)?THREE.MathUtils.clamp(value!,bounds[key][0],bounds[key][1]):1;}
    this.profile.drs=profile.drs!==false;this.profile.ers=profile.ers!==false;
    if(!this.profile.drs)this.drsOpen=0;
    if(!this.profile.ers)this.ersSystem.cancel();
  }

  /** OFFLINE preparation only. Call before race/reset or a stationary garage
   * swap; callers must retain Formula geometry for network-authoritative cars.
   * Never changes profile coefficients, fixed step, checkpoints or ERS state. */
  setVehicleGeometry(metadata?:unknown):void {
    if(this.disposed)return;
    const next=resolveVehicleGeometry(metadata);if(next===this.geometry)return;
    if(Math.abs(this.speed)>.1)throw Error('Change vehicle geometry only while stationary');
    const previous=this.geometry;
    this.chassis.setShape(chassisShape(next).shape);
    this.chassis.setMassProperties(MASS,{x:0,y:0,z:0},geometryInertia(next,MASS),{x:0,y:0,z:0,w:1});
    this.body.recomputeMassPropertiesFromColliders();this.geometry=next;
    this.wheelShapes=next.wheels.map(w=>{const edge=Math.min(.018,w.width*.2,w.radius*.15);return new RAPIER.RoundCylinder(w.width/2-edge,w.radius-edge,edge);});
    const q=this.body.rotation(),up=new THREE.Vector3(0,1,0).applyQuaternion(new THREE.Quaternion(q.x,q.y,q.z,q.w)),at=this.body.translation();
    this.body.setTranslation(new THREE.Vector3(at.x,at.y,at.z).addScaledVector(up,next.chassisOffset-previous.chassisOffset),true);
    next.wheels.forEach((w,i)=>this.wheelHeights[i]=w.y);this.accumulator=0;this.events.clear();this.syncState();this.poseRevision++;
  }
  get vehicleGeometry():VehicleGeometry{return this.geometry;}

  /** Compact authoritative motion state for bounded client reconciliation. */
  captureMotion(){
    const at=this.body.translation(),q=this.body.rotation(),v=this.body.linvel(),w=this.body.angvel();
    return {body:[at.x,at.y,at.z] as [number,number,number],rotation:[q.x,q.y,q.z,q.w] as [number,number,number,number],
      linear:[v.x,v.y,v.z] as [number,number,number],angular:[w.x,w.y,w.z] as [number,number,number],
      grip:this.gripMultiplier,contacts:this.collisionCount};
  }
  restoreMotion(m:ReturnType<KartPhysics['captureMotion']>,state:{steer:number;drsOpen:number;poseRevision:number;ers:{energy:number;active:boolean;regenerating:boolean};wheelHeights:readonly number[]}){
    this.body.setTranslation({x:m.body[0],y:m.body[1],z:m.body[2]},true);
    this.body.setRotation({x:m.rotation[0],y:m.rotation[1],z:m.rotation[2],w:m.rotation[3]},true);
    this.body.setLinvel({x:m.linear[0],y:m.linear[1],z:m.linear[2]},true);
    this.body.setAngvel({x:m.angular[0],y:m.angular[1],z:m.angular[2]},true);
    this.body.resetForces(true);this.body.resetTorques(true);this.events.clear();
    this.accumulator=0;this.impactCooldown=0;this.buriedSeconds=0;this.edgePinnedSeconds=0;this.edgeReleaseSeconds=0;
    this.gripMultiplier=m.grip;this.collisionCount=m.contacts;this.poseRevision=state.poseRevision;
    this.steer=state.steer;this.drsOpen=state.drsOpen;this.ersSystem.cancel();Object.assign(this.ers,state.ers);
    state.wheelHeights.forEach((h,i)=>this.wheelHeights[i]=h);this.syncState();this.steeringAngle=this.steer*this.steeringRange;
  }

  step(dt: number, input: KartInput): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    this.automatedHandling=input.automated===true;
    this.accumulator += Math.min(dt, 0.10);
    while (this.accumulator >= DT - 1e-8) {
      if(!this.networkHandling)this.ghostSeconds=Math.max(0,this.ghostSeconds-DT);
      this.fixedStep(input);
      this.accumulator -= DT;
    }
    this.syncState();
  }

  private wheelSupport(index:number,origin:THREE.Vector3,rotation:THREE.Quaternion,up:THREE.Vector3){
    const allowed=(collider:RAPIER.Collider)=>collider.handle===this.floor.handle||collider.handle===this.kerb.handle||collider.handle===this.road?.handle;
    const direction=up.clone().negate(),range=SUSPENSION_REST+SUSPENSION_TRAVEL;
    let hit=this.world.castShape(origin,rotation,direction,this.wheelShapes[index],0,range,true,undefined,undefined,this.chassis,this.body,allowed);
    let lift=0;
    // An initially overlapping tyre can return a zero-distance contact on the
    // underside/edge of a thin road mesh. That normal is not a support normal.
    // Recast from clear air, retaining signed compression below the origin.
    if(hit&&(hit.time_of_impact<1e-5||new THREE.Vector3().copy(hit.normal1).dot(up)<.2)){
      lift=.65;
      hit=this.world.castShape(origin.clone().addScaledVector(up,lift),rotation,direction,this.wheelShapes[index],0,range+lift,true,undefined,undefined,this.chassis,this.body,allowed);
    }
    if(!hit)return null;
    const normal=new THREE.Vector3().copy(hit.normal1).normalize();
    if(normal.dot(up)<.2)return null;
    return{travel:hit.time_of_impact-lift,normal};
  }

  /** A powered nose resting on a rail has no bicycle steering authority at
   * zero speed. Let it scrub inward and align with the local road, using
   * bounded forces rather than moving its pose or skipping race progress. */
  private releasePinnedEdge(input:KartInput):void {
    if(this.networkHandling||Math.abs(input.throttle)<=.1||input.brake>=.1){this.edgePinnedSeconds=0;this.edgeReleaseSeconds=0;return;}
    const motion=this.body.linvel();
    if(this.edgeReleaseSeconds<=0&&Math.hypot(motion.x,motion.z)>=4){this.edgePinnedSeconds=0;return;}
    const at=this.body.translation(),velocity=this.body.linvel();
    const near=this.track.nearestTrack(at.x,at.z,at.y-this.geometry.chassisOffset);
    const width=this.track.trackHalfWidthAt(near.t);
    const q=this.body.rotation(),up=new THREE.Vector3(0,1,0).applyQuaternion(new THREE.Quaternion(q.x,q.y,q.z,q.w));
    const safeZone=up.y>.7&&near.distance>width-this.geometry.length/2-.4
      &&near.distance<this.track.trackRailOffsetAt(near.t)+1&&!this.track.PIT.contains(at.x,at.z)
      &&Math.abs(at.y-this.geometry.chassisOffset-this.track.roadHeightAt(at.x,at.z,at.y-this.geometry.chassisOffset))<.65;
    if(!safeZone){this.edgePinnedSeconds=0;this.edgeReleaseSeconds=0;return;}
    let touching=false;
    this.world.contactPairsWith(this.chassis,other=>{
      // Dynamic/kinematic race traffic must never trigger wall assistance.
      if(other.parent()||!(this.barrierHandles.has(other.handle)||other.handle===this.kerb.handle))return;
      if(this.chassis.contactCollider(other,.03))touching=true;
    });
    const eligible=touching&&Math.hypot(velocity.x,velocity.z)<4&&near.distance>width-this.geometry.length/2-.2;
    this.edgePinnedSeconds=eligible?this.edgePinnedSeconds+DT:0;
    if(this.edgePinnedSeconds>=.12)this.edgeReleaseSeconds=1;
    this.edgeReleaseSeconds=Math.max(0,this.edgeReleaseSeconds-DT);
    if(this.edgeReleaseSeconds<=0||near.distance<width-this.geometry.length/2-.4)return;
    const side=Math.sign((at.x-near.x)*Math.cos(near.heading)-(at.z-near.z)*Math.sin(near.heading));
    // Align whichever end already faces the direction of travel; reverse
    // remains useful and no preferred lap direction is imposed.
    const heading=Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.z*q.z));
    const delta=Math.atan2(Math.sin(near.heading-heading),Math.cos(near.heading-heading));
    const target=Math.abs(delta)>Math.PI/2?Math.atan2(Math.sin(delta+Math.PI),Math.cos(delta+Math.PI)):delta;
    const nx=side*Math.cos(near.heading),nz=-side*Math.sin(near.heading),force=this.body.userForce();
    const release=Math.max(0,force.x*nx+force.z*nz)+MASS*12;
    this.body.addForce({x:-nx*release,y:0,z:-nz*release},true);
    this.body.addTorque({x:0,y:THREE.MathUtils.clamp(target*40-this.body.angvel().y*8,-20,20),z:0},true);
  }

  private cornerGrip(speed:number,automated=false){return this.networkHandling||automated?1:1+.24*(1-THREE.MathUtils.smoothstep(Math.abs(speed),22,34));}
  private yawLimit(speed:number,original:number,automated=false){return this.networkHandling||automated?original:original*(1+.30*(1-THREE.MathUtils.smoothstep(Math.abs(speed),22,34)));}

  /** Restore the velocity parallel to a static rail after the solver removes
   * its normal component. Traffic stays entirely under collision simulation. */
  private slideBarrier(before:{x:number;y:number;z:number},input:KartInput){
    this.barrierContact=false;
    if(this.networkHandling)return;
    this.world.contactPairsWith(this.chassis,other=>{
      if(other.parent()||!this.barrierHandles.has(other.handle))return;
      let touching=false;
      this.world.contactPair(this.chassis,other,manifold=>{if(manifold.numContacts()>0)touching=true;});
      if(!touching)return;
      const contact=this.chassis.contactCollider(other,.06);
      if(!contact)return;
      const normal=new THREE.Vector3(contact.normal1.x,0,contact.normal1.z);
      if(normal.lengthSq()<.2)return;
      normal.normalize();this.barrierContact=true;
      const at=this.body.translation(),near=this.track.nearestTrack(at.x,at.z,at.y-this.geometry.chassisOffset);
      const outward=new THREE.Vector3(at.x-near.x,0,at.z-near.z);
      if(normal.dot(outward)<0)normal.negate();
      const velocity=new THREE.Vector3().copy(this.body.linvel());
      const previous=new THREE.Vector3(before.x,0,before.z),tangent=previous.clone().addScaledVector(normal,-previous.dot(normal));
      const speed=tangent.length(),current=velocity.clone().setY(0);
      current.addScaledVector(normal,-current.dot(normal));
      if(speed>current.length())current.copy(tangent).multiplyScalar(.995);
      // A small clearance speed prevents the chassis repeatedly binding on
      // neighbouring triangles while the engine is still aimed into the rail.
      if(Math.abs(input.throttle)>.1)current.addScaledVector(normal,-.8);
      velocity.set(current.x,velocity.y,current.z);this.body.setLinvel(velocity,true);
      const heading=Math.atan2(2*(this.body.rotation().w*this.body.rotation().y+this.body.rotation().x*this.body.rotation().z),1-2*(this.body.rotation().y**2+this.body.rotation().z**2));
      const roadDelta=Math.atan2(Math.sin(near.heading-heading),Math.cos(near.heading-heading));
      const target=Math.abs(roadDelta)>Math.PI/2?Math.atan2(Math.sin(roadDelta+Math.PI),Math.cos(roadDelta+Math.PI)):roadDelta;
      const omega=this.body.angvel();
      // Powered scraping turns toward the tangent, rather than ricocheting.
      this.body.setAngvel({x:omega.x,y:Math.abs(input.throttle)>.1?THREE.MathUtils.clamp(target*5,-3,3):omega.y*.5,z:omega.z},true);
    });
  }

  private fixedStep(input: KartInput): void {
    if(this.spatial){this.fixedStep3D(input);return;}
    this.impactCooldown = Math.max(0, this.impactCooldown - DT);
    const throttle = THREE.MathUtils.clamp(input.throttle, -1, 1);
    const brake = THREE.MathUtils.clamp(input.brake, 0, 1);
    this.drsOpen=0; // Legacy tracks retain the same long car but have noDRS zones.
    const steering = THREE.MathUtils.clamp(input.steer, -1, 1);
    const handbrake=input.drift===true&&this.profile.handbrakeGrip<1;
    this.steer += (steering - this.steer) * (1 - Math.exp(-DT * (this.steeringRate(steering,input.automated) * THREE.MathUtils.clamp(this.steeringSensitivity, .75, 1.25)*this.profile.responseScale)));
    const q = this.body.rotation();
    this.heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    const forward = { x: Math.sin(this.heading), z: Math.cos(this.heading) };
    const right = { x: Math.cos(this.heading), z: -Math.sin(this.heading) };
    const velocity = this.body.linvel();
    const forwardSpeed = velocity.x * forward.x + velocity.z * forward.z;
    const sidewaysSpeed = velocity.x * right.x + velocity.z * right.z;
    const angularSpeed = this.body.angvel().y;
    const at = this.body.translation();
    this.body.resetForces(true);
    this.body.resetTorques(true);

    let grounded = 0;
    const steeringAngle = this.steer * steeringLimit(forwardSpeed,this.networkHandling,input.automated)*this.profile.steerScale;this.steeringAngle=steeringAngle;
    const aero=this.aeroForSpeed(forwardSpeed);
    for(const [z,load]of [[this.geometry.frontAxleZ,aero.frontLoad],[this.geometry.rearAxleZ,aero.rearLoad]])
      this.body.addForceAtPoint({x:0,y:-MASS*load,z:0},{x:at.x+forward.x*z,y:at.y,z:at.z+forward.z*z},true);
    for (const [index,wheel] of this.geometry.wheels.entries()) {
      const wheelX=wheel.x,wheelZ=wheel.z,originY=wheel.y-this.geometry.chassisOffset+.13;
      const rx = right.x * wheelX + forward.x * wheelZ;
      const rz = right.z * wheelX + forward.z * wheelZ;
      const point = { x: at.x + rx, y: at.y+originY, z: at.z + rz };
      const localSteer=index<2?geometryAckermann(steeringAngle,wheelX,this.geometry):0;
      const wheelRotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,this.heading+localSteer,Math.PI/2,'YXZ'));
      const hit = this.world.castShape(point, wheelRotation, down, this.wheelShapes[index], 0,
        SUSPENSION_REST + SUSPENSION_TRAVEL, true, undefined, undefined,
        this.chassis, this.body, (collider) => collider.handle === this.floor.handle || collider.handle === this.kerb.handle);
      this.wheelHeights[index]=this.geometry.chassisOffset+originY-(hit?.time_of_impact??SUSPENSION_REST);
      if (!hit) continue;
      grounded++;
      const compression = SUSPENSION_REST - hit.time_of_impact;
      const springForce = THREE.MathUtils.clamp(compression * 180 - velocity.y * SUSPENSION_DAMPING*this.profile.suspensionDampingScale, 0, MASS * 98.1 * 0.65);
      this.body.addForceAtPoint({ x: 0, y: springForce, z: 0 }, point, true);

      // Each axle sees its own contact velocity and tire direction; lateral
      // impulses therefore also generate yaw rather than teleporting rotation.
      const wheelAngle = this.heading + localSteer;
      const wx = Math.cos(wheelAngle);
      const wz = -Math.sin(wheelAngle);
      const contactVX = velocity.x + angularSpeed * rz;
      const contactVZ = velocity.z - angularSpeed * rx;
      const lateral = contactVX * wx + contactVZ * wz;
      const rearGrip=wheelZ<0?this.profile.rearGripScale*(handbrake?this.profile.handbrakeGrip:1):1;
      const tyreGrip = (this.networkHandling ? (wheelZ > 0 ? .90 : .98) : (wheelZ > 0 ? HANDLING_TUNE.frontGrip : HANDLING_TUNE.rearGrip))*rearGrip*this.cornerGrip(forwardSpeed,input.automated);
      const maxGrip = Math.max(springForce, MASS * 98.1 / 8) * tyreGrip*this.profile.gripScale*THREE.MathUtils.clamp(this.gripMultiplier,.25,1.25);
      const lateralForce = THREE.MathUtils.clamp(-lateral * 5.0*rearGrip, -maxGrip, maxGrip);
      this.body.addForceAtPoint({ x: wx * lateralForce, y: 0, z: wz * lateralForce }, point, true);
    }

    const ersAllowed=this.ersAllowed&&!this.track.PIT.contains(at.x,at.z);
    const boostForce=this.ersSystem.begin(DT,{requested:input.boost===true,throttle,brake,speed:forwardSpeed,grounded:grounded>=3,allowed:ersAllowed});
    if (grounded > 0) {
      const driveFraction = grounded / 4;
      const availableTraction=80*THREE.MathUtils.clamp(this.gripMultiplier,.25,1.25);
      const rawEngine = throttle * (38 * this.enginePace)*this.profile.engineScale * Math.max(0, 1 - (Math.max(0,forwardSpeed*Math.sign(throttle)) / (throttle < 0 ? 6 : this.topSpeed*this.profile.topSpeedScale)) ** 4);
      const engine=THREE.MathUtils.clamp(rawEngine*(1+boostForce),-availableTraction,availableTraction);
      const rolling = -forwardSpeed * (Math.abs(throttle) < .01 ? .30 : .055) - aero.drag;
      const braking = Math.abs(forwardSpeed) > 0.08
        ? -Math.sign(forwardSpeed) * Math.min(Math.max(brake * 46*this.profile.brakeScale,handbrake?8:0), availableTraction, Math.abs(forwardSpeed) / DT) : 0;
      const driveForce = MASS * (engine + rolling + braking) * driveFraction;
      this.body.addForce({ x: forward.x * driveForce, y: 0, z: forward.z * driveForce }, true);

      // Bounded arcade assistance damps a fishtail while retaining tire slip,
      // momentum and Rapier's collision impulses. It cannot move the car.
      const desiredYaw = THREE.MathUtils.clamp(forwardSpeed / this.geometry.wheelbase * Math.tan(steeringAngle), -this.yawLimit(forwardSpeed,2.4,input.automated), this.yawLimit(forwardSpeed,2.4,input.automated));
      const yawAssist = THREE.MathUtils.clamp((desiredYaw - angularSpeed) * 0.14*(handbrake?.5:1), -0.30, 0.30);
      this.body.addTorque({ x: 0, y: yawAssist, z: 0 }, true);
      if (Math.abs(forwardSpeed) < 0.08 && Math.abs(sidewaysSpeed) < 0.08 && Math.abs(throttle) < 0.01) {
        this.body.setLinvel({ x: 0, y: velocity.y, z: 0 }, true);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    this.releasePinnedEdge(input);
    const beforeContact=this.body.linvel();
    this.world.step(this.events);
    this.slideBarrier(beforeContact,input);
    this.events.drainCollisionEvents((a, b, started) => {
      if (!started || this.impactCooldown > 0) return;
      if ((a === this.chassis.handle && this.barrierHandles.has(b))
        || (b === this.chassis.handle && this.barrierHandles.has(a))) {
        this.collisionCount++;
        this.impactCooldown = 0.20;
      }
    });
    const end=this.body.translation(),endVelocity=this.body.linvel();
    this.ersSystem.finish(DT,forwardSpeed,endVelocity.x*forward.x+endVelocity.z*forward.z,
      (end.x-at.x)*forward.x+(end.z-at.z)*forward.z,brake*46*this.profile.brakeScale*grounded/4,this.impactCooldown>0||!ersAllowed||this.track.PIT.contains(end.x,end.z));
  }

  /** Four independent suspension sweeps on the real raised/banked mesh. Body
   * pitch/roll remain dynamic; the bounded torque below only damps instability. */
  private fixedStep3D(input:KartInput):void {
    this.impactCooldown=Math.max(0,this.impactCooldown-DT);
    const throttle=THREE.MathUtils.clamp(input.throttle,-1,1),brake=THREE.MathUtils.clamp(input.brake,0,1),steering=THREE.MathUtils.clamp(input.steer,-1,1);
    const handbrake=input.drift===true&&this.profile.handbrakeGrip<1;
    if(brake>.02||handbrake||!this.profile.drs)this.drsOpen=0;
    this.steer+=(steering-this.steer)*(1-Math.exp(-DT*this.steeringRate(steering,input.automated)*THREE.MathUtils.clamp(this.steeringSensitivity,.75,1.25)*this.profile.responseScale));
    const rotation=this.body.rotation(),q=new THREE.Quaternion(rotation.x,rotation.y,rotation.z,rotation.w);
    const forward=new THREE.Vector3(0,0,1).applyQuaternion(q),right=new THREE.Vector3(1,0,0).applyQuaternion(q),up=new THREE.Vector3(0,1,0).applyQuaternion(q);
    const at=new THREE.Vector3().copy(this.body.translation()),velocity=new THREE.Vector3().copy(this.body.linvel()),omega=new THREE.Vector3().copy(this.body.angvel());
    const speed=velocity.dot(forward),steerAngle=this.steer*steeringLimit(speed,this.networkHandling,input.automated)*this.profile.steerScale;this.steeringAngle=steerAngle;
    this.body.resetForces(true);this.body.resetTorques(true);
    const aero=this.aeroForSpeed(speed);
    for(const [z,load]of [[this.geometry.frontAxleZ,aero.frontLoad],[this.geometry.rearAxleZ,aero.rearLoad]])
      this.body.addForceAtPoint(up.clone().multiplyScalar(-MASS*load),at.clone().addScaledVector(forward,z),true);
    let grounded=0,deepContacts=0,minTravel=Infinity;const supportNormal=new THREE.Vector3();
    for(const [index,wheel] of this.geometry.wheels.entries()) {
      const wheelX=wheel.x,wheelZ=wheel.z,originY=wheel.y-this.geometry.chassisOffset+.13;
      const offset=right.clone().multiplyScalar(wheelX).addScaledVector(forward,wheelZ).addScaledVector(up,originY),origin=at.clone().add(offset);
      const angle=index<2?geometryAckermann(steerAngle,wheelX,this.geometry):0;
      const wheelRotation=q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,angle,Math.PI/2,'YXZ')));
      const hit=this.wheelSupport(index,origin,wheelRotation,up);
      this.wheelHeights[index]=this.geometry.chassisOffset+originY-(hit?.travel??SUSPENSION_REST);
      if(!hit)continue;
      const normal=hit.normal;
      grounded++;supportNormal.add(normal);
      if(hit.travel<-.16)deepContacts++;
      minTravel=Math.min(minTravel,hit.travel);
      const contactVelocity=omega.clone().cross(offset).add(velocity);
      const spring=THREE.MathUtils.clamp((SUSPENSION_REST-hit.travel)*180-contactVelocity.dot(up)*SUSPENSION_DAMPING*this.profile.suspensionDampingScale,0,MASS*98.1*.65);
      // Spring force follows its actual chassis-mounted suspension axis. Using
      // the sphere's edge normal here injected a horizontal force at kerb lips
      // and pinned a stopped nose against the wall even with reverse engaged.
      this.body.addForceAtPoint(up.clone().multiplyScalar(spring),origin,true);
      const tireForward=forward.clone().multiplyScalar(Math.cos(angle)).addScaledVector(right,Math.sin(angle));
      const lateralAxis=normal.clone().cross(tireForward).normalize();
      const rearGrip=wheelZ<0?this.profile.rearGripScale*(handbrake?this.profile.handbrakeGrip:1):1;
      const grip=(this.networkHandling ? (wheelZ>0?.90:.98) : (wheelZ>0?HANDLING_TUNE.frontGrip:HANDLING_TUNE.rearGrip))*rearGrip*this.cornerGrip(speed,input.automated)*this.profile.gripScale*THREE.MathUtils.clamp(this.gripMultiplier,.25,1.25);
      const maxGrip=Math.max(spring,MASS*98.1/8)*grip;
      const force=THREE.MathUtils.clamp(-contactVelocity.dot(lateralAxis)*5.0*rearGrip,-maxGrip,maxGrip);
      this.body.addForceAtPoint(lateralAxis.multiplyScalar(force),origin,true);
    }
    this.buriedSeconds=deepContacts>=3&&up.y>.7?this.buriedSeconds+DT:0;
    if(this.buriedSeconds>=.25){
      // A chassis already below a thin surface cannot spring back through its
      // solid underside. Repair that sustained invalid state along the current
      // suspension axis using the ACTUAL queried support. reset(x,z) would use
      // the nearest track height and could teleport a car from the room floor
      // onto a bridge overhead. This bounded correction never skips ahead.
      this.body.setTranslation(at.clone().addScaledVector(up,Math.min(.9,SUSPENSION_REST-minTravel)),true);
      this.body.setLinvel({x:0,y:0,z:0},true);
      this.body.setAngvel({x:0,y:0,z:0},true);
      this.body.resetForces(true);this.body.resetTorques(true);
      this.geometry.wheels.forEach((w,i)=>this.wheelHeights[i]=w.y+.13-SUSPENSION_REST);
      this.drsOpen=0;this.buriedSeconds=0;this.ersSystem.cancel();
      this.poseRevision++;this.groundingRecoveries++;
      return;
    }
    const ersAllowed=this.ersAllowed&&!this.track.PIT.contains(at.x,at.z);
    const boostForce=this.ersSystem.begin(DT,{requested:input.boost===true,throttle,brake,speed,grounded:grounded>=3&&up.y>.5,allowed:ersAllowed});
    if(grounded) {
      supportNormal.normalize();
      const driveDirection=forward.clone().addScaledVector(supportNormal,-forward.dot(supportNormal)).normalize();
      // Engine force follows the shared road pace; grip and brakes stay responsive.
      // Quadratic aero drag, rolling loss and gravity still determine speed.
      const availableTraction=80*THREE.MathUtils.clamp(this.gripMultiplier,.25,1.25);
      const rawEngine=throttle*(64 * this.enginePace)*this.profile.engineScale*Math.max(0,1-(Math.max(0,speed*Math.sign(throttle))/(throttle<0?6:this.topSpeed*this.profile.topSpeedScale))**4);
      const engine=THREE.MathUtils.clamp(rawEngine*(1+boostForce),-availableTraction,availableTraction);
      const rolling=-speed*(Math.abs(throttle)<.01?.30:.055)-aero.drag;
      const braking=Math.abs(speed)>.04?-Math.sign(speed)*Math.min(Math.max(brake*60*this.profile.brakeScale,handbrake?10:0),availableTraction,Math.abs(speed)/DT):0;
      this.body.addForce(driveDirection.multiplyScalar(MASS*(engine+rolling+braking)*grounded/4),true);
      const yaw=omega.dot(supportNormal),desiredYaw=THREE.MathUtils.clamp(speed/this.geometry.wheelbase*Math.tan(steerAngle),-this.yawLimit(speed,2.7,input.automated),this.yawLimit(speed,2.7,input.automated));
      this.body.addTorque(supportNormal.clone().multiplyScalar(THREE.MathUtils.clamp((desiredYaw-yaw)*.14*(handbrake?.5:1),-.30,.30)),true);
      const tiltRate=omega.clone().addScaledVector(supportNormal,-yaw);
      const stabilize=up.clone().cross(supportNormal).multiplyScalar(1.8).addScaledVector(tiltRate,-.35);
      if(stabilize.length()>.8)stabilize.setLength(.8);
      this.body.addTorque(stabilize,true);
    }
    this.releasePinnedEdge(input);
    const beforeContact=this.body.linvel();
    this.world.step(this.events);
    this.slideBarrier(beforeContact,input);
    this.events.drainCollisionEvents((a,b,started)=>{
      if(started&&this.impactCooldown<=0&&((a===this.chassis.handle&&this.barrierHandles.has(b))||(b===this.chassis.handle&&this.barrierHandles.has(a)))){this.collisionCount++;this.impactCooldown=.20;}
    });
    const end=this.body.translation(),endVelocity=this.body.linvel();
    this.ersSystem.finish(DT,speed,endVelocity.x*forward.x+endVelocity.y*forward.y+endVelocity.z*forward.z,
      (end.x-at.x)*forward.x+(end.y-at.y)*forward.y+(end.z-at.z)*forward.z,brake*60*this.profile.brakeScale*grounded/4,this.impactCooldown>0||!ersAllowed||this.track.PIT.contains(end.x,end.z));
  }

  private syncState(): void {
    const at = this.body.translation();
    const q = this.body.rotation();
    if(this.spatial) {
      const quat=new THREE.Quaternion(q.x,q.y,q.z,q.w),forward=new THREE.Vector3(0,0,1).applyQuaternion(quat),up=new THREE.Vector3(0,1,0).applyQuaternion(quat),right=new THREE.Vector3(1,0,0).applyQuaternion(quat);
      this.position.set(at.x,at.y,at.z).addScaledVector(up,-this.geometry.chassisOffset);
      this.heading=Math.atan2(forward.x,forward.z);this.pitch=Math.asin(THREE.MathUtils.clamp(forward.y,-1,1));this.roll=Math.atan2(right.y,up.y);
      const velocity=new THREE.Vector3().copy(this.body.linvel());this.speed=velocity.dot(forward);this.slip=Math.atan2(velocity.dot(right),Math.max(Math.abs(this.speed),.5));return;
    }
    this.position.set(at.x, at.y - this.geometry.chassisOffset, at.z);
    this.heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    const v = this.body.linvel();
    const forwardSpeed = v.x * Math.sin(this.heading) + v.z * Math.cos(this.heading);
    const lateralSpeed = v.x * Math.cos(this.heading) - v.z * Math.sin(this.heading);
    this.speed = forwardSpeed;
    this.slip = Math.atan2(lateralSpeed, Math.max(Math.abs(forwardSpeed), 0.5));
  }

  reset(x = this.track.trackPoint(0).x, z = this.track.trackPoint(0).z, heading = this.track.trackPoint(0).heading, surfaceY?:number): void {
    const {nearestTrack,trackFrame,trackHalfWidthAt,roadShoulderAt,roadHeightAt,PIT}=this.track;
    if (this.disposed) return;
    this.ersSystem.cancel();this.ghostSeconds=0;this.barrierContact=false;this.edgePinnedSeconds=0;this.edgeReleaseSeconds=0;
    this.body.setTranslation({ x, y: SURFACE_Y + this.geometry.chassisOffset, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }, true);
    if(this.spatial) {
      const near=nearestTrack(x,z,surfaceY),up=near.distance<4?trackFrame(near).up:new THREE.Vector3(0,1,0);
      const forward=new THREE.Vector3(Math.sin(heading),0,Math.cos(heading)).addScaledVector(up,-(Math.sin(heading)*up.x+Math.cos(heading)*up.z)).normalize();
      const right=up.clone().cross(forward).normalize(),q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,forward.clone().cross(right),forward));
      const position=new THREE.Vector3(x,near.distance<trackHalfWidthAt(near.t)+roadShoulderAt(near.t)?roadHeightAt(x,z,surfaceY):PIT.contains(x,z)?SURFACE_Y:ROOM_FLOOR_Y,z).addScaledVector(up,this.geometry.chassisOffset);
      this.body.setTranslation(position,true);this.body.setRotation(q,true);
    }
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.heading = heading;
    this.steer = this.speed = this.slip = this.pitch = this.roll = 0;
    this.drsOpen=0;
    this.steeringAngle=0;this.geometry.wheels.forEach((w,i)=>this.wheelHeights[i]=w.y);
    this.pitProtected=false;
    for(const item of this.traffic.values()){item.suppressed=false;item.collider.setSensor(false);this.barrierHandles.add(item.collider.handle);}
    this.collisionCount = 0;
    this.accumulator = 0;
    this.impactCooldown = 0;
    this.buriedSeconds = 0;
    this.poseRevision++;
    this.events.clear();
    this.syncState();
  }

  /** Other cars are collidable kinematic chassis in this car's Rapier world.
   * They never become suspension surfaces. Large respawns do not sweep a wall
   * of traffic across the room. This is not a shared-world momentum solver. */
  setTraffic(cars:ReadonlyArray<TrafficCar>):void {
    if(this.disposed)return;const keep=new Set<string>(),selfProtected=this.pitProtectionActive;
    for(const car of (this.ghostSeconds>0&&!this.networkHandling?[]:cars)){if((car.ghost&&!this.networkHandling)||!car.id||![car.x,car.y,car.z,car.heading].every(Number.isFinite))continue;keep.add(car.id);let item=this.traffic.get(car.id);
      const geometry=car.geometry?resolveVehicleGeometry(car.geometry):DEFAULT_VEHICLE_GEOMETRY;
      const pitch=Number.isFinite(car.pitch)?car.pitch!:0,roll=Number.isFinite(car.roll)?car.roll!:0;
      const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch,car.heading,roll,'YXZ'));
      const at=new THREE.Vector3(car.x,car.y,car.z).addScaledVector(new THREE.Vector3(0,1,0).applyQuaternion(q),geometry.chassisOffset);
      if(!item){const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x,at.y,at.z));const collider=this.world.createCollider(chassisShape(geometry).setFriction(.12).setRestitution(.04),body);item={body,collider,suppressed:false,geometry};this.traffic.set(car.id,item);this.barrierHandles.add(collider.handle);body.setRotation(q,true);}
      if(item.geometry!==geometry){item.collider.setShape(chassisShape(geometry).shape);item.geometry=geometry;}
      const protectedPair=selfProtected||(car.pitProtected===true&&this.inPitProtectionZone(car));
      // At handback, finish separating an already-overlapping pair before
      // restoring its contact. No new pair can acquire protection on the road.
      // The separation sphere encloses both complete chassis plus two units
      // of swept-motion clearance before restoring a solid kinematic proxy.
      const overlapping=Math.hypot(car.x-this.position.x,car.y-this.position.y,car.z-this.position.z)<(this.geometry.length+geometry.length)/2+2;
      const suppressed=protectedPair||(item.suppressed&&overlapping);
      if(suppressed!==item.suppressed){item.suppressed=suppressed;item.collider.setSensor(suppressed);
        if(suppressed)this.barrierHandles.delete(item.collider.handle);else this.barrierHandles.add(item.collider.handle);}
      const before=item.body.translation();if(Math.hypot(before.x-at.x,before.y-at.y,before.z-at.z)>5)item.body.setTranslation(at,true);
      item.body.setNextKinematicTranslation(at);item.body.setNextKinematicRotation(q);
    }
    for(const [id,item] of this.traffic)if(!keep.has(id)){this.barrierHandles.delete(item.collider.handle);this.world.removeRigidBody(item.body);this.traffic.delete(id);}
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.events.free();
    this.world.free();
    this.barrierHandles.clear();
    this.traffic.clear();
  }
}
