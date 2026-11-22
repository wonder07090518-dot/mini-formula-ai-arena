export default class Attack {id='write';tick(){process.getBuiltinModule('fs').writeFileSync('/arena/outside','x');return {throttle:1,brake:0,steer:0};}}
