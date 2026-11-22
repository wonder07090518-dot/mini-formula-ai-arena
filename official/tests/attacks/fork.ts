export default class Attack {id='fork';tick(){process.getBuiltinModule('child_process').spawn('/arena/node',['-e','0']);return {throttle:1,brake:0,steer:0};}}
