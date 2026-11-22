# Driving bots (game simulation)

This repository is not the full Mini Formula game. The public repository is
https://github.com/wonder07090518-dot/mini-formula-ai-arena .
The operator entry point currently provides a study smoke test only;
private-engine scoring is not implemented.

Write a single deterministic TypeScript bot using the
[API](docs/ai-arena-bot-api.ts) and [handout](docs/ai-arena-bot-prompt.md).
It receives a read-only view each tick and returns `throttle`, `brake`, and
`steer`. Finite controls are clamped to [0, 1], [0, 1], and [-1, 1]; non-finite
values become zero. The intended isolated child has a 20 ms wall-time budget
per frame; a timeout or exception produces zero controls and is counted. No
filesystem, network, child processes, or runtime imports are allowed. The
handout describes the exact contract and other restrictions.

The [local practice scorer](practice/README.md) is dry, study only, with orbit, club and one
lap by default. Install dependencies with `npm ci`, then run:

```sh
npm start -- --bot examples/noop-bot.ts --track study --seed 7 --laps 1 --weather dry
```

Seed 7 is a practice seed, distinct from the round-2 seeds;
future official seeds and official track geometry are not included here.
Practice is not an official result.

Submit a self-contained bot via a public GitHub pull request or issue using the
templates; submission is free. Official
runs are intended to use newly derived seeds per accepted submission; the
[derivation](docs/seed-derivation.md) specifies the auditable algorithm.

The round-2 penalty was 0.5 seconds per wall hit: a hit is a rising edge of
`physics.barrierContact`, recorded as `wallHitCount`. Continuous contact counts
once; separation followed by another contact counts again. Penalized time is
`totalTime + 0.5 * wallHitCount`. Historical figures and disclosures are in the
[round-2 reference](docs/round2-reference.md).
