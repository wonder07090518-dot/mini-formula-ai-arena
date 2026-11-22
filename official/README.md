# Operator study smoke scorer (game simulation)

Fetch and inspect a submission locally first; never run submitted code in a
GitHub workflow. From the repository root, after `npm ci`, run:

```sh
./official/score.sh --bot examples/noop-bot.ts --track study --seed 7 --laps 1 --weather dry
node --test official/tests/*.test.mjs
```

This currently scores only the study practice track and labels output
`official: false`. `--engine` is deliberately rejected: private-engine
integration is not implemented. Do not treat this as an official score.

Each TypeScript submission is transpiled without executing it, staged, and
started under bubblewrap. The child protocol is newline-delimited JSON over
stdin/stdout. The child receives no host environment (`--clearenv`) except
PATH, HOME and NODE_NO_WARNINGS. It has isolated user, PID, IPC and network
namespaces; no host home, workspace or credential directories are mounted.
The node executable, loader, C libraries and staged files are read-only. Root
and /dev are remounted read-only; /tmp is a writable 16 MiB tmpfs. Capabilities are
dropped. `prlimit` limits CPU to 60 seconds, virtual address space to 2 GiB,
processes/threads to 32 and output files to 1 MiB. V8 heap is limited to 128
MiB. The 2 GiB address-space cap accommodates Node's virtual reservations;
it is not a 2 GiB physical-memory guarantee. The parent kills and restarts a
child after a 20 ms tick deadline, with zero controls for that frame.

The limit on CPU is cumulative per child; long races may require a higher
operator-selected limit after benchmarking. Timeouts can vary with host load.
No seccomp filter or cgroup is configured. Kernel and runtime vulnerabilities,
resource use before limits are applied, output flooding and side channels are
residual risks. This is defense in depth, not a perfect hostile-code sandbox.
Do not use this as a substitute for a disposable, unprivileged machine.
