/** Interpolate fixed physics samples for a variable-refresh display. Only the
 * rendered pose changes; collisions, lap timing and controls keep fixed steps. */
export interface PoseSource {position:{x:number;y:number;z:number};heading:number;pitch:number;roll:number;wheelHeights:readonly number[];poseRevision?:number}
export interface VisualPose {x:number;y:number;z:number;heading:number;pitch:number;roll:number;wheels:number[]}
const angle=(a:number,b:number,t:number)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
const copy=(target:VisualPose,source:PoseSource)=>{target.x=source.position.x;target.y=source.position.y;target.z=source.position.z;target.heading=source.heading;target.pitch=source.pitch;target.roll=source.roll;for(let i=0;i<4;i++)target.wheels[i]=source.wheelHeights[i];};
const blank=():VisualPose=>({x:0,y:0,z:0,heading:0,pitch:0,roll:0,wheels:[0,0,0,0]});
export class RenderPose {
 private previous=blank();private current=blank();private output=blank();
 private revision:number|undefined;
 constructor(source:PoseSource){this.reset(source);}
 reset(source:PoseSource){this.revision=source.poseRevision;copy(this.previous,source);copy(this.current,source);return this.sample(1);}
 push(source:PoseSource){
  if(source.poseRevision!==this.revision||Math.hypot(source.position.x-this.current.x,source.position.y-this.current.y,source.position.z-this.current.z)>6){this.reset(source);return;}
  const a=this.previous,b=this.current;
  a.x=b.x;a.y=b.y;a.z=b.z;a.heading=b.heading;a.pitch=b.pitch;a.roll=b.roll;
  for(let i=0;i<4;i++)a.wheels[i]=b.wheels[i];
  copy(this.current,source);
 }
 sample(fraction:number){
  const t=Math.max(0,Math.min(1,fraction)),a=this.previous,b=this.current,o=this.output;
  o.x=a.x+(b.x-a.x)*t;o.y=a.y+(b.y-a.y)*t;o.z=a.z+(b.z-a.z)*t;
  o.heading=angle(a.heading,b.heading,t);o.pitch=angle(a.pitch,b.pitch,t);o.roll=angle(a.roll,b.roll,t);
  for(let i=0;i<4;i++)o.wheels[i]=a.wheels[i]+(b.wheels[i]-a.wheels[i])*t;
  return o;
 }
}
