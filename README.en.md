# Driving bots (game simulation)

This repository is a work in progress and is not the full Mini Formula game.
The practice scorer and official isolator are not yet available; do not use
this repository to execute untrusted submissions. The repository URL will be
announced later.

Write a single deterministic TypeScript bot using the
[API](docs/ai-arena-bot-api.ts) and [handout](docs/ai-arena-bot-prompt.md).
It receives a read-only view each tick and returns `throttle`, `brake`, and
`steer`. Finite controls are clamped to [0, 1], [0, 1], and [-1, 1]; non-finite
values become zero. The intended isolated child has a 20 ms wall-time budget
per frame; a timeout or exception produces zero controls and is counted. No
filesystem, network, child processes, or runtime imports are allowed. The
handout describes the exact contract and other restrictions.

The intended local practice pack is dry, study only, with orbit, club and one
lap by default. Seed 7 is a practice seed, distinct from the round-2 seeds;
future official seeds and official track geometry are not included here.
Practice is not an official result.

Once the repository URL is announced, submit a self-contained bot via a public
GitHub pull request or issue using the templates; submission is free. Official
runs are intended to use newly derived seeds per accepted submission; the
[derivation](docs/seed-derivation.md) specifies the auditable algorithm.

The round-2 penalty was 0.5 seconds per wall hit: a hit is a rising edge of
`physics.barrierContact`, recorded as `wallHitCount`. Continuous contact counts
once; separation followed by another contact counts again. Penalized time is
`totalTime + 0.5 * wallHitCount`. Historical figures and disclosures are in the
[round-2 reference](docs/round2-reference.md).
