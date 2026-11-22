// Orbit-only subset of the Mini Formula vehicle catalog.
export interface VehicleProfile {
 engineScale:number; dragScale:number; downforceScale:number; gripScale:number; steerScale:number;
 topSpeedScale?:number; brakeScale?:number; responseScale?:number; rearGripScale?:number;
 handbrakeGrip?:number; suspensionDampingScale?:number; drs?:boolean; ers?:boolean;
}
const orbit={id:'orbit',profile:{engineScale:1,dragScale:1,downforceScale:1,gripScale:1,steerScale:1}};
export const CARS=[orbit];
export function carFor(id:string){if(id!=='orbit')throw Error('Only orbit is available');return orbit;}
export function vehicleCapabilities(id:string){if(id!=='orbit')throw Error('Only orbit is available');return {drs:true,ers:true,handbrake:false};}
