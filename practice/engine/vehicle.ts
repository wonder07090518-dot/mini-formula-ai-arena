import * as THREE from 'three';
import {DEFAULT_VEHICLE_GEOMETRY} from './vehicle-geometry';
export type VehicleDesignId = string;
export type VehicleModel = ReturnType<typeof createVehicle>;
export function createVehicle(_rival: boolean, _design: string, _number: number) {
  const root = new THREE.Group();
  root.userData = {...DEFAULT_VEHICLE_GEOMETRY};
  return {root, setLivery(_value: unknown) {}, setTyreCompound(_value: unknown) {}, update(..._args: unknown[]) {}, dispose() { root.removeFromParent(); }};
}
