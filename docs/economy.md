# economy baseline before room tiers

for the progression changes in #6. these are controlled, deterministic engine
profiles, not human playtests, physical-phone timings or user-provided saves.
no income, price or service parameter was changed for this measurement.

baseline: 0.1.155, source `2c6a3e9ead06bc413e23da14f03e02080f71dccb`.
Node26.13.0, fixed 1/60-second simulation steps, seeds37 and71, both existing
jails. the acquisition and measurement policies below are part of the result.
two seeds do not establish a typical player's earnings or upgrade payback time.

## reproduce

from a checkout with dependencies installed:

```sh
node --experimental-strip-types scripts/measure-economy.mjs /tmp/jailbirds-economy
```

the supplied directory receives twelve profile records, their minute snapshots
and generated worlds. output is not added to the repo. the script records the
checkout's HEAD. compare on a clean checkout and record any source changes.
the baseline numbers here are from the exact source above, not whichever
version is current when the command is run again.

## existing content fully purchased

setup grants exactly the sum of authored prices and sets rank6. it suppresses
arrivals, incidents and boosts only during acquisition. the player then routes
to and actually buys every pad. the harness asserts every purchase exists,
the grant is fully spent and no residents exist yet. it saves and restores
that emitted world, then restores normal arrivals/incidents/boost scheduling.
the grant and setup time are not earned-money or time-to-max measurements.

each profile runs600 simulation seconds with the player stationary, either
at the starting point or at the safe's collection point. no manual needs,
floor pickup, boost pickup or incident response. all hired helpers work.

| jail / seed | total new money | final wallet at start / safe | safe at start / safe | releases | rank money |
|---|---:|---:|---:|---:|---:|
| pine hill /37 |1090|340 /908|568 /0|47|340|
| pine hill /71 |1102|340 /920|580 /0|48|340|
| desert rock /37 |1084|340 /920|580 /0|47|340|
| desert rock /71 |1018|340 /876|536 /0|42|340|

all begin with zero money and end at rank10. total includes wallet, desk/safe
piles, collector bags and floor coins. each park pair has the same generated
money but a different accessible wallet. the collector moves desk/release
money to the safe, not home floor coins. floor coins reach the existing
eight-per-house cap,64 across the eight houses, in all these cases.

| jail / seed | check-in | release | rank | incident | home floor |
|---|---:|---:|---:|---:|---:|
| pine hill /37 |126|470|340|90|64|
| pine hill /71 |128|480|340|90|64|
| desert rock /37 |126|470|340|84|64|
| desert rock /71 |116|420|340|78|64|

check-in counts newly uniformed ids times the authored payment. release and
incident amounts use their event counters and authored payments. rank money
uses the existing accounting counter. home-floor money is the remaining
whole nonnegative balance, not an independent event counter. the script
asserts it is whole and nonnegative. faster generation cannot be inferred
from a capped stationary balance. desert rock's cost/coin-frequency scaling
does not imply twice the collected money under this policy.

## fresh, unserviced first two releases

fresh rank1 worlds receive no budget grant or purchases. the player checks in
two, leads them to a cell, waits away until their time is served, then returns
to their actually assigned cell and leads them to release. no manual needs.
the wait is away from the doorway so automatic pickup does not keep needy
residents following instead of serving time. this is a fixed limited policy,
not a representative complete new-player journey.

| jail / seed | simulation seconds | total new money | final wallet | rank money |
|---|---:|---:|---:|---:|
| pine hill /37 |114.5833|50|26|20|
| pine hill /71 |114.5833|50|26|20|
| desert rock /37 |114.5833|53|29|20|
| desert rock /71 |110.9667|53|29|20|

all end rank2 with two released and no purchases. these four cases do not
measure an active player's full-service earning potential.

## save evidence and limits

`tests/fixtures/v0.1.155-maxed-pine-hill.json` and
`tests/fixtures/v0.1.155-maxed-desert-rock.json` are the seed37 running-world
captures after600 seconds (start and safe respectively). they contain actual
engine-emitted residents/jobs, all old purchases, three escorts, all other
helper kinds, carried collector cash and occupied services. pine hill has a
stamped departure. desert rock has an active squabble. the restore test keeps
money, purchases, identity, bed/seat and served/recovery progress through four
reloads, then advances play. carried cash intentionally deposits into the safe
on reload, once. preserving bag location would be the wrong contract.

these do not replace the separate partial-payment, medical, boost or travel
tests. neither is a captured human save. the older v0.1.21 fixture has rank3,
37 coins and no purchases/helpers. it is not evidence of a maxed jail.

the twelve profiles reproduced unchanged end states and totals after adding
the event ledger and save checks, then again after moving the harness into
the repo. no gameplay source changed during that comparison. do not rebalance
old income from this small baseline. measure each proposed capability and a
working active-player policy before claiming its economic benefit.
