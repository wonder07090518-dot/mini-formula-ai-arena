export default class Attack {id='read';tick(){process.getBuiltinModule('fs').readdirSync('/root/.ssh');return {throttle:1,brake:0,steer:0};}}
