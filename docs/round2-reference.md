# Round 2 reference / 第二场参考（游戏模拟 / game simulation）

The first round is void. The second round used dry conditions, orbit vehicles,
club difficulty, three laps, and five seeds on each of two tracks. Official
placement used penalized time; the baseline is a reference line with different
rules and is not ranked. The external bots were claude, codex, and grok; grok
was newly written by an independent author, and the archived organizer-written
version did not participate. All 40 car-runs finished; all had zero recoveries,
timeouts, and errors in the adopted results.

Five-run mean penalized time (seconds), copied from the round 2 report:

| Track | claude | codex | grok | baseline (reference) |
|---|---:|---:|---:|---:|
| Bedroom | 161.09333333333333 | 179.97 | 160.35 | 181.42666666666668 |
| Kitchen | 100.71333333333334 | 114.21333333333334 | 114.49666666666667 | 114.94333333333334 |
| Combined ten runs | 130.90333333333334 | 147.09166666666667 | 137.42333333333335 | 148.185 |

The track averages give different orders. Seeds 1 and 2914390916 produced
identical JSON except for the seed field on both tracks; both were counted in
the averages. Each adopted result was a byte-identical consecutive pair. Six
initial pairs differed in timeout frames and were rerun; the second run in a
rerun pair also recorded poses, though the adopted result JSON matched.
The baseline ran in process with exact sampling and exclusive traffic braking,
reverse and automatic boost, unlike the external bots. These numbers are
historical reference only.
