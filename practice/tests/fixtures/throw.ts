export default class ThrowBot {
  id = 'throw';
  tick() { throw Error('fixture'); }
}
