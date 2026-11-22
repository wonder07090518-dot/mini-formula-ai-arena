# Required isolation verification

The official scorer is disabled. Before enabling it, automated tests must assert
that host SSH files and environment secrets cannot be read, host loopback cannot
be reached, process creation is bounded, writes outside the temporary directory
fail, a looping tick times out at 20 ms, and excessive allocation is limited.
No claim is made that these tests have been implemented or passed.
