import {VEHICLE_SPEC as SPEC} from './vehicle-spec';

export interface WheelGeometry {readonly x:number;readonly y:number;readonly z:number;readonly radius:number;readonly width:number}
export interface VehicleGeometry {
 readonly kind:'formula'|'measured';readonly length:number;readonly width:number;readonly height:number;
 readonly wheelbase:number;readonly chassisOffset:number;readonly frontAxleZ:number;readonly rearAxleZ:number;
 readonly wheels:readonly WheelGeometry[];
}
const normalized=new WeakSet<object>();
function freeze(g:VehicleGeometry):VehicleGeometry{g.wheels.forEach(Object.freeze);Object.freeze(g.wheels);Object.freeze(g);normalized.add(g);return g;}
export const DEFAULT_VEHICLE_GEOMETRY=freeze({kind:'formula',length:SPEC.length,width:SPEC.width,height:SPEC.maxBodyHeight,wheelbase:SPEC.wheelBase,chassisOffset:.42,frontAxleZ:SPEC.frontAxleZ,rearAxleZ:SPEC.rearAxleZ,wheels:[
 {x:-SPEC.frontWheelX,y:SPEC.wheelRadius,z:SPEC.frontAxleZ,radius:SPEC.wheelRadius,width:SPEC.frontTyreWidth},
 {x:SPEC.frontWheelX,y:SPEC.wheelRadius,z:SPEC.frontAxleZ,radius:SPEC.wheelRadius,width:SPEC.frontTyreWidth},
 {x:-SPEC.rearWheelX,y:SPEC.wheelRadius,z:SPEC.rearAxleZ,radius:SPEC.wheelRadius,width:SPEC.rearTyreWidth},
 {x:SPEC.rearWheelX,y:SPEC.wheelRadius,z:SPEC.rearAxleZ,radius:SPEC.wheelRadius,width:SPEC.rearTyreWidth},
]});
/** Validates and copies measured local-root metadata. Undefined restores the
 * exact existing Formula dimensions. Call once at preparation, not per frame. */
export function resolveVehicleGeometry(input?:unknown):VehicleGeometry{
 if(input==null)return DEFAULT_VEHICLE_GEOMETRY;
 if(typeof input!=='object')throw Error('Vehicle geometry must be measured metadata');
 if(normalized.has(input))return input as VehicleGeometry;
 const root=input as Record<string,any>,d=root.dimensions??root;
 const finite=(n:unknown,a:number,b:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=a&&n<=b;
 if(!finite(d.length,1,8)||!finite(d.width,.4,4.5)||!finite(d.height,.2,3.5))throw Error('Invalid vehicle geometry bounds');
 let contacts=root.wheelContacts??root.wheels;
 if(!contacts&&root.serviceGeometry){const {hubs,widths}=root.serviceGeometry;if(Array.isArray(hubs)&&Array.isArray(widths))contacts=hubs.map((p:number[],i:number)=>({x:p[0],y:p[1],z:p[2],width:widths[i],radius:d.wheelRadius}));}
 if(!contacts){
  if(d.length===SPEC.length&&d.width===SPEC.width&&d.wheelbase===SPEC.wheelBase&&d.wheelRadius===SPEC.wheelRadius)return DEFAULT_VEHICLE_GEOMETRY;
  throw Error('Measured vehicle geometry requires four wheel contacts');
 }
 if(!Array.isArray(contacts)||contacts.length!==4)throw Error('Vehicle needs exactly four wheel contacts');
 const wheels:WheelGeometry[]=contacts.map((w,i)=>{
  if(!w||!finite(w.x,-d.width/2,d.width/2)||!finite(w.z,-d.length/2,d.length/2)||!finite(w.y,.03,1.5)||!finite(w.radius,.04,1.2)||!finite(w.width,.035,1))throw Error('Invalid measured wheel contact');
  if((i%2===0?w.x>=0:w.x<=0)||Math.abs(w.x)+w.width/2>d.width/2+.03||Math.abs(w.z)+w.radius>d.length/2+.08)throw Error('Wheel contact outside vehicle envelope');
  return{x:w.x,y:w.y,z:w.z,radius:w.radius,width:w.width};
 });
 const frontAxleZ=(wheels[0].z+wheels[1].z)/2,rearAxleZ=(wheels[2].z+wheels[3].z)/2,wheelbase=frontAxleZ-rearAxleZ;
 if(wheelbase<.5||frontAxleZ<=0||rearAxleZ>=0||Math.abs(wheels[0].z-wheels[1].z)>.04||Math.abs(wheels[2].z-wheels[3].z)>.04)throw Error('Invalid measured axle layout');
 const expected=DEFAULT_VEHICLE_GEOMETRY;
 if(Math.abs(d.length-expected.length)<1e-7&&Math.abs(d.width-expected.width)<1e-7&&Math.abs(d.height-expected.height)<1e-7&&wheels.every((w,i)=>Object.keys(w).every(k=>Math.abs(w[k as keyof WheelGeometry]-expected.wheels[i][k as keyof WheelGeometry])<1e-7)))return expected;
 return freeze({kind:'measured',length:d.length,width:d.width,height:d.height,wheelbase,chassisOffset:wheels.reduce((s,w)=>s+w.y,0)/4+.13,frontAxleZ,rearAxleZ,wheels});
}
/** Same calibrated steering angle limit; measured wheelbase only changes each
 * wheel's Ackermann geometry. Gameplay response coefficients stay untouched. */
export function geometryAckermann(angle:number,wheelX:number,g:VehicleGeometry){
 if(Math.abs(angle)<1e-6)return 0;
 const sign=Math.sign(angle),radius=g.wheelbase/Math.tan(Math.abs(angle));return sign*Math.atan(g.wheelbase/(radius-sign*wheelX));
}
export function chassisVertices(g:VehicleGeometry):Float32Array{
 const result:number[]=[];
 const sections=g.kind==='formula'?[[SPEC.chassisHalfWidth,-.18,.18,-SPEC.chassisHalfLength,SPEC.chassisHalfLength],[SPEC.width/2,-.28,-.18,SPEC.length/2-.16,SPEC.length/2],[.76,.20,.32,-SPEC.length/2,-SPEC.length/2+.24]]:[[g.width/2,.08-g.chassisOffset,g.height-g.chassisOffset,-g.length/2,g.length/2]];
 for(const [width,y0,y1,z0,z1]of sections)for(const x of[-width,width])for(const y of[y0,y1])for(const z of[z0,z1])result.push(x,y,z);
 return new Float32Array(result);
}
export function geometryInertia(g:VehicleGeometry,mass:number){
 const halfWidth=g.kind==='formula'?SPEC.chassisHalfWidth:g.width/2,halfLength=g.kind==='formula'?SPEC.chassisHalfLength:g.length/2;
 // Retain the established low vertical mass distribution. Cosmetic cabin/
 // driver height extends collision clearance but cannot make the car top-heavy.
 return{x:mass/3*(.18**2+halfLength**2),y:mass/3*(halfWidth**2+halfLength**2),z:mass/3*(halfWidth**2+.18**2)};
}
