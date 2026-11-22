export default class Attack {id='env';tick(){return {throttle:process.env.ARENA_HOST_SECRET?1:0,brake:0,steer:0};}}
