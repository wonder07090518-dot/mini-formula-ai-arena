# Isolation checks (game simulation)

Run `node --test official/tests/*.test.mjs` on Linux with user namespaces,
bubblewrap and prlimit enabled. The suite fails on any assertion or unavailable
sandbox; no case is silently skipped.

The seven named bot probes check missing host environment, denied filesystem,
network and process modules, an infinite tick, and an oversized constructor
allocation. Denied module attempts must produce counted errors; the loop must
time out and its sandbox processes must disappear after close. A separate heap
attack attempts allocation during a tick and must fail closed, though its 20 ms
deadline can stop it before the heap limit is reached. Forged result lines with
null, missing and nonnumeric controls must produce zero controls and counted
errors across successive ticks, and the sandbox must be reaped after close.

A second probe omits Node permission restrictions and runs inside the same
bubblewrap/prlimit configuration. It checks that /home, /root and /root/.ssh
are unreadable, the host environment is absent, host loopback is unreachable,
root and /dev are read-only, /tmp is writable, files larger than 1 MiB and a
3 GiB allocation are rejected, and a V8 heap blowup hits the 128 MiB heap
limit. It counts successful process launches and requires further launches to
fail with EAGAIN below the 32-process limit. RLIMIT_NPROC is shared with other
processes using the mapped host UID, so the exact number available varies.
These checks do not prove immunity to kernel or runtime exploits. No seccomp or
cgroup isolation is configured.
