/** Public snapshot types; this file has no runtime implementation. */
export interface RoadSample { x:number; z:number; heading:number; y?:number; pitch?:number; bank?:number }

/** A snapshot only: coordinates use the game's world units, heading points along
 * (sin heading, cos heading), and t wraps around the track in [0,1). */
export interface DrivingBotView {
  readonly x:number; readonly y:number; readonly z:number; readonly heading:number; readonly speed:number;
  readonly t:number; readonly distance:number; readonly steeringLimit:number; readonly wheelBase:number;
  readonly lane:number; readonly difficulty:'rookie'|'club'|'expert'; readonly rivalIndex:number;
  readonly seed:number; readonly dt:number; readonly time:number; readonly wetness:number; readonly previewWet:number;
  readonly tyreGrip:number; readonly tyreCompound:string; readonly ersEnergy:number; readonly ersAllowed:boolean;
  readonly traffic:readonly Readonly<{id:string;x:number;z:number;speed:number;heading:number}>[];
  readonly track:Readonly<{id:string;length:number;halfWidth:number;point:(t:number)=>Readonly<RoadSample>;nearest:(x:number,z:number,y?:number)=>Readonly<RoadSample & {t:number;distance:number;signedDistance:number}>}>;
}
export interface DrivingControls { readonly throttle:number; readonly brake:number; readonly steer:number }
export interface DrivingBot { readonly id:string; tick(view:DrivingBotView):DrivingControls }

