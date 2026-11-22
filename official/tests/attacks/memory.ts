export default class Attack {
  id = 'memory-cap-failed';
  constructor(){try { Buffer.allocUnsafe(3*1024*1024*1024); } catch { this.id='memory-cap-blocked'; }}
  tick(){return {throttle:this.id==='memory-cap-failed'?1:0,brake:0,steer:0};}
}
