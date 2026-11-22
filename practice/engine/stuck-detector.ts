/** Offline recovery policy; controllers supply race/pit/adventure exclusions.
 * A disabled or healthy sample always breaks the continuous 2.5 second hold. */
export const STUCK_TUNE = { seconds: 2.5, speed: 1.5, ghostSeconds: 1.5 } as const;
export interface StuckSample {
  speed: number;
  throttle: number;
  barrier: boolean;
  offTrack: boolean;
  countdown?: boolean;
  pit?: boolean;
  recoveryDelay?: boolean;
  bathAdventure?: boolean;
  paused?: boolean;
  finished?: boolean;
  online?: boolean;
  ghost?: boolean;
}
export function advanceStuck(seconds: number, dt: number, sample: StuckSample): {seconds:number; reset:boolean} {
  const excluded=sample.countdown||sample.pit||sample.recoveryDelay||sample.bathAdventure||sample.paused||sample.finished||sample.online||sample.ghost;
  const stuck=Math.abs(sample.speed)<STUCK_TUNE.speed&&(Math.abs(sample.throttle)>.1||sample.barrier)||sample.offTrack;
  if(excluded||!stuck||!Number.isFinite(dt)||dt<=0)return {seconds:0,reset:false};
  const next=seconds+Math.min(dt,.1);
  return next+1e-9>=STUCK_TUNE.seconds?{seconds:0,reset:true}:{seconds:next,reset:false};
}
