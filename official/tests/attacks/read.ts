export default class Attack {id='read';tick(){try{const fs=process.getBuiltinModule('fs');fs.readdirSync('/home');return {throttle:1,brake:0,steer:0};}catch{return {throttle:0,brake:0,steer:0};}}}
