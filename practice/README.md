# Study practice (game simulation)

Install Node.js 24, npm, bubblewrap and util-linux `prlimit`, then from the
repository root run:

```sh
npm ci
npm start -- --bot examples/noop-bot.ts --track study --seed 7 --laps 1 --weather dry
npm test
```

Only `study` and `dry` are accepted. Default seed is 7 and default lap count is
1; 7 is not a round-2 seed. `--laps` accepts 1–20. The maximum duration is
10800 simulation ticks per lap; `--max-ticks` may lower it for smoke checks.
`--grid` accepts comma-separated bot paths or `baseline` for multi-car runs;
`--bot` selects a single bot. `baseline` has different rules as described in
the historical reference. JSON includes `gameSimulation: true` and
`official: false`; an unfinished car's total is elapsed simulation time.
Wall contacts are counted on rising edges and the penalty is 0.5 seconds each.

Practice uses the same local sandbox transport as the operator smoke test. It
requires Linux user namespaces and bwrap; it fails rather than running the bot
unsandboxed if startup fails. Frame timeouts depend on wall-clock scheduling and
can make runs differ on a busy host. This package does not contain official
track geometry or future official seeds. It is not the full game.
