/** A grippy miniature racer: quick response, with a speed-sensitive steering
 * stop that communicates braking rather than suddenly spinning at full lock. */
import { VEHICLE_SPEC } from './vehicle-spec';
/** Shared road pace; pit-lane speed is tuned independently. */
export const LEGACY_ROAD_PACE = 3.4;
export const HANDLING_PACE_SCALE = 1.10;
export const ROAD_PACE = LEGACY_ROAD_PACE * HANDLING_PACE_SCALE;
export const HANDLING_TUNE = { steeringApplyRate: 19, steeringReturnRate: 21, frontGrip: .95, rearGrip: 1.08 } as const;
export const ROAD_PACE_RATIO = ROAD_PACE / 3.5;
export const MAX_SPEED = 48 * ROAD_PACE_RATIO;
export function steeringLimit(speed: number, legacy = false, automated = false): number {
  const v = Math.abs(speed);
  const mechanical = (.64 - .20 * Math.min(v / (legacy ? 48 * LEGACY_ROAD_PACE / 3.5 : MAX_SPEED),1)) * 1.24;
  // Preserve useful low-speed lock, then progressively reduce steering
  // authority as speed rises. Network races retain the original limit.
  const blend=Math.max(0,Math.min(1,(v-20)/12));
  const cornerAllowance=76*(1+.18*(1-blend*blend*(3-2*blend)));
  const tireLimit = Math.atan(cornerAllowance * VEHICLE_SPEC.wheelBase / Math.max(v*v,1));
  if(automated&&!legacy)return Math.min(mechanical*.9,tireLimit*(1-.12*Math.min(v/MAX_SPEED,1)));
  const lowSpeed = 1 - Math.min(1, Math.max(0, (v - 22) / 12));
  return Math.min(mechanical * (legacy ? 1 : .9 + .30 * lowSpeed),
    tireLimit * (legacy ? 1 : (1 - .12 * Math.min(v / MAX_SPEED, 1)) * (1 + .28 * lowSpeed)));
}
/** Shared wheel geometry: the inside front wheel follows a tighter circle. */
export function ackermannSteer(centerAngle:number,wheelX:number):number {
  if(Math.abs(centerAngle)<1e-6)return 0;
  const sign=Math.sign(centerAngle),radius=VEHICLE_SPEC.wheelBase/Math.tan(Math.abs(centerAngle));
  return sign*Math.atan(VEHICLE_SPEC.wheelBase/(radius-sign*wheelX));
}

/** Accelerations from aerodynamic forces, before multiplying by car mass.
 * Opening the flap reduces total aero drag16% and rear-wing load35%; it
 * supplies no engine force. Rolling resistance is deliberately separate. */
export function formulaAero(speed:number,opening=0) {
  const open=Number.isFinite(opening)?Math.max(0,Math.min(1,opening)):0;
  return {drag:.022*speed*Math.abs(speed)*(1-.16*open),
    frontLoad:.006*speed*speed,rearLoad:.012*speed*speed*(1-.35*open)};
}
