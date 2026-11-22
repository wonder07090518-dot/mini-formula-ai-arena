# Isolation checks (game simulation)

Run `node --test official/tests/*.test.mjs` on Linux with user namespaces,
bubblewrap and prlimit enabled. The suite fails on any assertion or unavailable
sandbox; no case is silently skipped.

On this machine the following bot probes passed: access to `/home` denied;
`ARENA_HOST_SECRET` absent; host loopback listener not reached; fork attempt
blocked; file creation outside /tmp blocked; an infinite tick returned zero
controls after its deadline; a 3 GiB allocation failed under the memory cap.
The bot probes exercise Node permission and import restrictions as well as the
sandbox. The loop and memory probes have a 15-second overall test deadline.

A second probe deliberately omits Node permission restrictions and runs inside
the same bubblewrap/prlimit configuration. It independently checks absent
/home, empty host secret, unreachable host loopback listener, read-only root
and /dev, writable /tmp, rejection of files larger than 1 MiB, rejection of a
3 GiB allocation and process creation beyond the nproc limit. That probe
initially exposed writable sandbox directories; root and /dev were remounted
read-only and the probe was rerun. It does not prove immunity to kernel or
runtime exploits. No seccomp or cgroup isolation is configured.
