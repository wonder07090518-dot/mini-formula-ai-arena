export default class ExampleBot {
  readonly id = 'example';
  constructor(_seed: number) {}
  tick(_view: unknown) {
    return { throttle: 0, brake: 0, steer: 0 };
  }
}
