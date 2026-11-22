# Mini Formula driving bot

Create one deterministic driving bot for the Mini Formula **game simulation**. You receive only this prompt and the types-only file `docs/ai-arena-bot-api.ts`. Submit a single TypeScript file. Use one of these exports:

```ts
// Default class: id is a stable string, constructor takes the run seed.
export default class MyBot {
  readonly id = 'my-bot';
  constructor(seed: number) { /* initialize deterministic state */ }
  tick(view: DrivingBotView): DrivingControls { /* return controls */ }
}
```

Or `export function createBot(seed: number)` returning an object with the same `id: string` and `tick(view): {throttle, brake, steer}` shape. The class can implement the `DrivingBot` interface from the types-only file; constructor arguments are separate from that instance interface. Include any needed type declarations in your submission, or use type-only imports that disappear when compiled. Runtime imports of other files are unavailable. `id` must be a nonempty stable string of at most 100 characters.

Treat the view as read-only. It contains world position `x`, `y`, `z`, heading, speed, normalized progress `t`, accumulated distance, steering limit, wheelbase, lane, difficulty, rival index, seed, simulation `dt` and time, weather and tyre information, ERS energy and availability, traffic snapshots, and track sampling. Positions use game world units. Heading zero points along positive z; forward is `(sin(heading), cos(heading))` in x/z. Progress `t` wraps around one lap. `track.point(t)` samples the centerline; `track.nearest(x,z,y)` estimates the nearest road point and signed lateral distance. Both operate on an interpolated detached centerline table reconstructed by the trusted child bootstrap, so they are approximate, especially at crossings and tight corners. `track.halfWidth` is nominal, not a per-position edge measurement. `lane` is an engine planning hint, not a constraint.

Return finite throttle and brake in [0, 1] and steer in [-1, 1]. Values are clamped, and non-finite values become zero. Other fields, including `target`, `boost`, and `drift`, are ignored. The engine provides automated handling and owns physics, collisions, progress, recovery and pit handling; it can take control during pit or recovery states. External on-track controls are not given the baseline's traffic braking, special speed caps, reverse maneuver or automatic boost decision. External bots cannot request boost or reverse. Do not manipulate physics, other cars, progress, energy or game state.

Your bot runs in a persistent isolated child process and must be cheap: each tick has a **20 ms wall-time** budget. A timeout or throw applies `{throttle: 0, brake: 0, steer: 0}` for that frame; timeouts restart the child and are counted, as are errors. Do not use filesystem or network access, child processes, worker threads, dynamic imports of game internals, or other attempts to bypass the rules. Do not cheat. The child receives snapshots and returns controls; it does not receive game modules.

The constructor and `view.seed` receive the run seed. Derive any random choices deterministically from it. Solo starts at slot `seed % 8`. A grid of N cars assigns slots 1 through N using a Fisher–Yates permutation driven by a 32-bit LCG initialized from the run seed; all cars use the same `orbit` vehicle design and profile. The comparison goal is to finish the requested laps and minimize total time and best lap.

Keep any presentation clearly labeled as a game simulation. Do not add a website URL or use these terms: F1, 排行榜, 永久免费, 无广告, 无内购, 最多8人, beta, 3A, 写实, MK8.
