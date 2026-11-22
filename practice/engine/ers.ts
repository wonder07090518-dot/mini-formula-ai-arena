/** Bounded energy assistance shared by every physical driver, including AI.
 * Energy is normalized, not a claim to real Formula 1 battery specifications. */
export const ERS_TUNE=Object.freeze({forceBonus:.12,drainPerSecond:1/8,minSpeed:1.5,maxRegenPerSecond:.16,kineticRecovery:.32,referenceSpeed:48*(3.4/3.5)});
export interface ErsTelemetry {energy:number;active:boolean;regenerating:boolean}
export interface ErsFrame {requested:boolean;throttle:number;brake:number;speed:number;grounded:boolean;allowed:boolean}
export class ErsSystem {
 readonly telemetry:ErsTelemetry={energy:1,active:false,regenerating:false};
 private rechargeAllowed=false;
 resetRace(){this.telemetry.energy=1;this.cancel();}
 cancel(){this.telemetry.active=false;this.telemetry.regenerating=false;this.rechargeAllowed=false;}
 /** Returns additional engine-force fraction; never changes speed or base grip. */
 begin(dt:number,frame:ErsFrame):number {
  this.cancel();
  if(!Number.isFinite(dt)||dt<=0||dt>.1||![frame.throttle,frame.brake,frame.speed,this.telemetry.energy].every(Number.isFinite))return 0;
  this.telemetry.energy=Math.max(0,Math.min(1,this.telemetry.energy));
  if(!frame.allowed||!frame.grounded||frame.speed<ERS_TUNE.minSpeed)return 0;
  this.rechargeAllowed=frame.brake>.01&&Math.abs(frame.throttle)<.01;
  if(!frame.requested||frame.throttle<=.15||frame.brake>.01||this.telemetry.energy<=0)return 0;
  const required=ERS_TUNE.drainPerSecond*dt,spent=Math.min(required,this.telemetry.energy);
  this.telemetry.energy=Math.max(0,this.telemetry.energy-spent);this.telemetry.active=spent>0;
  return ERS_TUNE.forceBonus*spent/required;
 }
 /** Recover only energy actually lost in a forward, grounded braking step.
  * Collision impulses, teleports, reverse, standstill and passive coasting
  * cannot charge. The brake-force cap excludes gravity/collision harvesting. */
 finish(dt:number,beforeSpeed:number,afterSpeed:number,forwardDistance:number,brakeDeceleration:number,blocked:boolean){
  if(!this.rechargeAllowed||blocked||!Number.isFinite(dt)||dt<=0||![beforeSpeed,afterSpeed,forwardDistance,brakeDeceleration].every(Number.isFinite))return;
  if(beforeSpeed<ERS_TUNE.minSpeed||afterSpeed<0||afterSpeed>=beforeSpeed||forwardDistance<=.001||brakeDeceleration<=0)return;
  const loss=Math.min(beforeSpeed-afterSpeed,brakeDeceleration*dt);
  const recovered=Math.min(ERS_TUNE.maxRegenPerSecond*dt,ERS_TUNE.kineticRecovery*(beforeSpeed*beforeSpeed-(beforeSpeed-loss)**2)/(ERS_TUNE.referenceSpeed**2));
  const before=this.telemetry.energy;this.telemetry.energy=Math.min(1,before+recovered);this.telemetry.regenerating=this.telemetry.energy>before;
 }
}
