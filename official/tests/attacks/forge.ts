export default class Attack {
 id='forge'; seq=0;
 tick(){
  const seq=++this.seq;
  const controls=seq===1?null:seq===2?undefined:{throttle:'bad',brake:0,steer:0};
  process.stdout.write(JSON.stringify({kind:'result',seq,controls})+'\n');
  return {throttle:1,brake:0,steer:0};
 }
}
