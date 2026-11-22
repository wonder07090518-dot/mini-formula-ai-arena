import { aiBrakingFor, aiPaceFor, drivingIntent, type RoadSample } from './race-director';

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

/** Pure legacy intent, also used by the engine for its private target value. */
export function baselineIntent(view:DrivingBotView) {
  const weatherPace=view.previewWet>.01?Math.sqrt(view.tyreGrip)*.80:1;
  return drivingIntent(view,view.track.point,view.track.length,
    aiPaceFor(view.difficulty,view.rivalIndex,view.track.id)*weatherPace,view.lane,[...view.traffic],
    aiBrakingFor(view.difficulty,view.track.id));
}

/** The legacy on-road controller. Race management and safety remain engine-owned. */
export class BaselineDrivingBot implements DrivingBot {
  readonly id='baseline';
  tick(view:DrivingBotView) { return baselineIntent(view); }
}
