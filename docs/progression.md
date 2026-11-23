# jail growth and a place worth growing

implementation contract for #6, #23, #34, #36 and #45. original baseline:
0.1.121/source64a0128. current accepted release: 0.1.155/source2c6a3e9.
this is the current sequence, not a claim that unshipped features exist.
exact-head review and release checks apply to every slice.

## direction and what is already done

build a friendly, working jail diorama: do a job, hire help, improve the room,
then open a genuinely new place. keep the peg people, original low-poly art,
hands-on movement, both orientations and adjustable camera. no ads, premium
currency, paid rescue, deleted residents or progress resets.

the named map, per-jail saves, current-only reset, rubble cell reveals,
collector, extra escort guards, hygiene/unrest, stamp, sound and feedback are
already shipped. hospital care, riots, the incident guard, environment art
and tall wall cutaways are also shipped. they are not future deliverables.
pine hill and desert rock still share a footprint. room tiers and genuinely
distinct new layouts remain ahead.

## delivery split and order

| slice | deliverable | can start | release condition |
|---|---|---|---|
| A1 | walls, caps, frames, ground, trees and fence | now, on current footprint | saves and geometry unchanged, phone views/readability pass |
| C1 | one incident model, riot warning, manual calming and free home recovery | alongside A1, engine/types/tests first | recovery works without any purchased facility |
| C2 | care annex, two/four treatment beds and care visuals | after C1's transitions are proven | paid care is faster, never required |
| G1 | one incident-response guard | after C1/C2 | player and guard share one hold, never double rewards |
| A2 | taller camera-aware wall cutaways and working bars | after A1 | no visual barrier across an open collision path |
| P1 | goal card, room tiers, staff training and measured cash pacing | after core care loop | maxed old saves have useful new targets |
| M3 | snowy peak: a new top-entry layout and activity | after layout fixtures | real playable content before selling its unlock |

keep these separate reviews. no feature branch that combines every system.
new content uses the current engine/data model, not a second simulation or
a renderer-owned progress ledger. care moves ahead of the wider room catalogue
because riot recovery must exist before escalation is enabled.

## C1: incidents and recovery

1. `World.alert` remains the only incident authority. distinguish squabble
   from riot and warning from active state there. use the existing `fightIn`
   clock for scheduling, not a second event scheduler. preserve old
   alerts as squabbles when their new fields are absent.
2. riots start at rank3 or higher when an incident is due and at least3
   eligible residents in one block have unrest>=0.6. a block means its member
   houses, not one two-bed cell: membership is containment of the house room
   inside the block rectangle. select at most4 residents, stable id order.
   exclude followers, people in service/care/release, done residents and anyone
   already claimed. no participant can be claimed by two jobs.
3. warning lasts5 simulation seconds. reserve ids in the one alert, revalidate
   before activation, and cancel without a reward if fewer than3 remain
   eligible, including the unrest threshold. cleaning that lowers unrest can
   prevent activation; that is intended. ordinary services continue for
   unreserved residents. pause, hidden state and inactive jails
   do not advance warning, unrest, recovery or cooldown.
4. current block rendezvous is (360,210), with small separated standing spots
   along that clear corridor. people walk there on existing routes, never
   teleport out of beds or through walls. gathering starts during warning, but
   no calming hold accrues until activation. once active the player can
   intervene while people are still arriving. the alert marker points to this
   reachable anchor.
5. being within40 of the anchor calms an active riot in3 contiguous simulation
   seconds; movement within that radius does not reset it. reset the hold when
   no valid responder is present. no response
   deadline removes residents, drains money or blocks unrelated intake/release.
   after resolution reset `fightIn` with the ordinary squabble reset. also set
   a30-second riot-eligibility floor that counts down at1 simulation second per
   second, unaffected by the upset multiplier. this is a veto on riot selection,
   not another scheduler: a due incident during the floor may still be a
   squabble. a squabble keeps its minimum of4 at home, its normal/upset burn
   rates and its reset. a riot crowd of3 has its own minimum, so the one shared
   `fightIn` clock can run with only those3 at home. time it has run stays run:
   when the crowd calms it holds, never rewinds or resets, and a later fourth
   resident continues from there. a due clock gives one incident, then the
   ordinary reset.
6. reward is the existing6 floor coins at the anchor, once per resolved
   incident, not a direct wallet credit. remove the alert
   in the same simulation transition as reward/settled count. warning
   cancellation pays nothing. restore never resolves/rewards an event itself.
7. after a riot one remaining participant, lowest id, gets a comic bump. retain
   home, bed slot, served progress and identity. others return home on routes.
   clamp unrest down to at most0.3, never increase a calmer resident to0.3.
8. use one bounded recovery-work value, initially20 and zero when healthy.
   at home it falls by1 per simulation second, so recovery is always free.
   no health bar or continuously decaying medical need.
   a locked, absent or full hospital cannot suspend home recovery from a bump.
   sickness (#68) is the one thing that does not rest off: once a care bed is
   open, someone well at home may get a tummy ache, cold or stubbed toe, never
   more at once than there are open beds. they stay in bed, drop no money and
   get sadder until led to the nurse. nobody dies or is lost, and with no care
   bed open nobody gets sick, so a player can never be stuck on it.
9. while resting or being treated, ordinary need decay pauses and served time
   continues once per step. preserve its prior value. a bumped resident is not
   eligible for incidents or release until recovered. a done resident restored
   in care can finish recovery and then follow the ordinary one-time release.
10. default missing recovery fields to healthy on old saves. retain a valid
    active warning/riot, its remaining time/hold and valid participants.
    cancelling an invalid claim must release its actors safely, without reward
    or deleting their home. no stale target on another map world.

these are starting tuning values, not measured balance results. first release
must include manual calming and recovery together. do not ship a riot whose
only escape is an unimplemented or unaffordable room.

## C2: care annex, concrete footprint

the footprint is a preparation slice, not a separately releasable purchase.
release it only with working treatment, reservations, recovery and care art.
the initial two beds and the upgrade must do their advertised jobs before
either purchase is deployed.

append to the east of each existing jail. preserve all existing room, station,
seat, pad, boost, safe, mess and actor coordinates and ids. world becomes960x900.
the existing house capacity stays4..16; treatment beds never count as home beds.

| item | definition |
|---|---|
| room/station id | `hospital`, look `care` |
| room rectangle | x760, y310, width180, height210 |
| entrance | west wall, gap starts70 down, width60, midpoint(760,410) |
| delivery zone | x770, y375, width160, height70 |
| initial treatment seats | (805,355), (895,355) |
| extra treatment seats | (805,470), (895,470) |
| `hospital` pad | (850,560), rank3, after `cell4`, base cost80 |
| `carebeds` pad | same point, after `hospital`, rank5, base cost100 |
| `riotguard` pad | (850,625), after `hospital`, rank5, base cost150 |

retain the existing per-jail cost multiplier. only the next unbought member
appears on the care purchase point. beds3/4 require `carebeds`; the room and
first two require `hospital`. a new locked annex can reuse the bounded rubble
reveal. tests must distinguish the original six cell rooms from the new annex,
not silently weaken their identity or purchase checks.

reuse facility seat reservation and go/use/back routing. `care` is a service
request from the recovery value, not another entry in the ordinary need-decay
table. treatment removes recovery work at2.5 per simulation second: a full
case takes up to8 seconds instead of20 at home. partial progress survives a
transfer or reload. keep the original home bed reserved while the person is
away. helpers/player revalidate and reserve a free treatment seat before
leaving home. absent/full/locked care means remain/rest at home. losing a
valid reservation sends the person home safely, never into an endless queue.

the new width increases the current outbound bus travel by240/180=1.33 seconds.
that is an explicit consequence to measure in this content slice, not an
unrecorded income nerf or a reason to reset an old bus state. preserve existing
ride.x/t/state on restore. no unrelated price, pay or coin-frequency change.

care look: mint/cream bedding, ice pack, small original medical cabinet and
clear rest silhouette. no blood, guns, realistic injury or punitive isolation.
art must show the room's two/four actual seats and occupied reservations.

## G1: incident automation

one new helper kind, one purchase. helmet, shield and whistle. it calms both
squabbles and riots, does not escort, collect money or create a second alert.
covering ordinary squabbles as well as riots is deliberate: automation must
remove routine incident chores, not leave the smaller version manual forever.
use the existing idle grid and verify the additional helper fits.

player and guard contribute an OR condition to one incident hold, at most one
DT per step. both together cannot halve the intended hold. the guard must
actually walk into range. revalidate targets after cancellation, resolution,
travel and restore. no duplicate guard spawn/reward, no paid prerequisite
for manual resolution, no endlessly recurring job after a cleared incident.

## A1/A2: a coherent visual rebuild

1. keep the liked peg cast and its independent motions. do not restart the
   character redesign. environment uses warm concrete/salmon wall accents,
   lighter caps, grey service floors, mint care and green outside ground.
   night palette needs readable separation, not translucent controls on black.
2. A1: thicker-looking low walls, cap bands, door frames, layered floor edges,
   original grass/tree/fence silhouettes and gate posts. retain collision and
   coordinates. keep decoration outside routes, price pads, care slots and
   camera-critical silhouettes. no borrowed store art or new image downloads.
3. A2: tall back walls and camera-facing cutaways use a separate wall batch,
   never transparency on the shared props/people material. heads and current
   task remain readable at tilt15/zoom3 and reversed views. bars follow actual
   doorway openness; they cannot draw shut across an open route. no new lock
   mechanic, path wait or collision rule hidden in a visual animation.
4. service details arrive with their working feature: beds/mattresses/shelves,
   kitchen equipment, wet-room fittings, medical cabinet, guard equipment.
   prefer a coherent room over unrelated decorative clutter.
5. retain shared geometry, bounded instances and deterministic decoration
   independent of world RNG. measure calls/triangles/resources before/after,
   repeat theme/purchase/travel cycles, and inspect moving journeys. a desktop
   still is not a physical-device performance result.

## P1/M3: keep meaningful targets after automation

next-goal card shows an actual available purchase, its cost and effect, or the
next rank/content milestone. no promise that endless rank unlocks missing rooms.
add visible three-stage cell, kitchen/canteen and shower improvements plus
staff speed/carry training. each tier changes a specific measured capability,
not just a cosmetic multiplier. preserve earned money and current purchases.
measure an existing maxed save and a fresh run before changing income pacing.
do not halve all earnings as part of an art patch.

do not move old pine hill/desert rock residents into a redesigned layout.
make snowy peak the first genuinely new top-entry site: bus/gate/scanner/desk
flow downward, service branches off a clear spine, separate release route,
and a working activity with its own visible production. its complete layout
and route fixture are a separate content review, not implied by this contract.
keep it unsold/coming later until that content and its unlock are playable.

remaining feature queue, in order: work/mine loop; phone/recreation; visiting
room; earned capacity/outfit/VIP variety; bounded return earnings. each needs
its own useful action, feedback and automation before becoming mandatory.
no new ordinary need drains on an old save before its service is available.
closed map worlds are not silently simulated. any away-income popup needs a
specified cap and idempotent accounting first. laundry/library/utilities stay
optional, not assumed requirements for parity.

### P1.1: next-goal card

1. `goal(w, l)` in sim.ts, next to `hint()`: pure, deterministic, never mutates
   the world or the level. nothing is saved; it is worked out again when asked.
   engine words only, no jail words.
2. pad goal: among pads that are `padVisible` (not bought, any `after` already
   bought) and whose rank is at most the current rank, the one with the least
   money left to pay, `cost - paid`. a tie goes to content order. it gives
   `{ kind: "pad", id, label, cost, paid }` with the honest total cost and what
   is paid so far. so at rank 3 with line1 bought, line2 paid 34 of 35 beats an
   unbought cell3 at 8: 1 left against 8.
3. rank goal, only when there is no pad goal: among visible pads above the
   current rank, the lowest such rank R. it gives `{ kind: "rank", rank: R, id,
   label }` for one real pad at R, the first in content order. it never makes up
   rank+1 when no pad needs it: at rank 2 with the next real pad at 5, it says 5.
   a pad behind an unbought `after` is not visible and does not count.
4. otherwise null: no real content left, whatever the rank.
5. on screen: one compact row in the hud under the stats. a pad goal shows its
   label, a small paid/cost and a thin bar like the rank bar. a rank goal reads
   "level R: label". during an alert, and when the goal is null, the row is
   hidden but keeps its height, so the jail never jumps between states. it
   costs the canvas about 20px; that is accepted. the action tip stays as it
   is. no new nav, tap target or camera change.
6. no change to prices, earnings, money rate, capacity, helper speeds or any
   content data.

## P1.2: useful room stages, then staff training

room stages shipped in0.1.175. staff training remains a separate capability/
walk-bound review and release, after P1.1's goal card and the room stages.
the controlled baseline and its
limits live in [economy.md](economy.md). existing
income, prices, needs, home capacity and layouts stay intact. three stages
means the existing room plus two real upgrades, not three paid reskins.

| target | current stage | stage2 | stage3 |
|---|---|---|---|
| each existing two-bed cell | home stay progress1x |1.15x while actually home |1.30x while actually home |
| kitchen | tray fill every0.30s |0.24s |0.18s |
| canteen, both tables | meal use1.50s |1.20s |0.90s |
| showers, all open seats | use2.50s |2.00s |1.50s |
| hired staff walking |85 units/s |100 units/s |115 units/s |
| cook tray stack |4 |5 |6 |

times are nominal settings, measured with fixed-step rounding when
implemented. these are capability choices, not measured economic gains.
faster seat turnover may change the realised number of visits and messes
even though need decay and mess probabilities stay fixed. measure it rather
than promising unchanged mess counts per minute.
cell upgrades improve future served progress only. they do not rewrite the
already served value, the75-unit target, ordinary needs or recovery work.
both healthy and bumped residents progress at the improved rate while home.
care keeps its existing recovery speed and served rate. walking/following
does not gain served time. no new bed slots in the old small cell footprint.
staff walking applies to all six hired kinds, not the warden or residents.
escort follower speed uses the same improved leader speed. carry training
affects the cook, not the player's stack or a collector's cash capacity.
Kitchen fill-time improvements apply to both the player and the hired cook
at the same stove. They do not change either one's carrying capacity.

starting prices and gates for review, not a payback-duration claim:

| purchase chain | stage2 / stage3 base cost | rank | prerequisite for stage2 |
|---|---:|---|---|
| each cell |40 /80 |4 /7 | its existing cell unlock, if any |
| kitchen |100 /180 |4 /7 | cook hired |
| canteen |100 /180 |4 /7 | second table bought |
| showers |100 /180 |4 /7 | third shower bought |
| staff walking |120 /220 |5 /8 | first escort hired |
| cook carry |120 /220 |5 /8 | cook hired |

stage3 always follows its own stage2. retain the existing per-jail cost
multiplier.26 purchases cost2480 in pine hill and4960 in desert rock.
the baseline's stationary safe balance is not a measured time to earn that
amount. do not lower old earnings to stretch the catalogue. old rank6 worlds
get useful stage2 targets immediately and actual future stage3 gates. a new
player cannot buy an upgrade for a locked/unavailable service.

derive effects from the existing bought ids and content values. do not save
a second tier ledger or derived rates. no retroactive bill, money reset,
resident/bed relocation or progress re-scaling. old fields retain their
meaning. unbought upgrades retain the released capability exactly.

payment centres, reusing each centre for its own two-stage chain:

- cells0..7: x67,151,235,304,416,487,571,655 at y249. the middle two shift
  aside from the riot anchor; the row also clears every house's squabble reach.
- kitchen(370,490), canteen(240,540), showers(735,560).
- staff walking(850,700), cook carry(850,765).

geometry probe on the unchanged0.1.155 walls: both jails, each13 centres,
actual movement from the start, body-radius wall checks on every step.
reproduce with `node --experimental-strip-types scripts/measure-tier-footprints.mjs`.
all26 reached. authored room and staff payment radii do not overlap each other, any old
payment radius, existing station work circles/service rectangles or the
manual incident radius. this is an all-open geometry projection, not a
purchase test or native phone view. room centres are read from the real
content. The original projection
checked house work circles but missed their larger squabble calming reach.
All16 house/jail combinations now have real active-squabble no-payment tests.
the current payment radius is24 and calming reach40. each of the two
middle cell centres is sqrt(56^2+39^2)=68.242 units from the anchor,
4.242 beyond the sum64. Unshifted cells are65 from their own house point,
1 beyond that sum. pin no payment at the closest calming points
through real steps, so enlarging the payment radius cannot quietly erase
that margin. the room release authors11 centres/22 purchases. the other
two centres/four purchases are authored in the separate staff-training candidate.

art stays inside existing footprints: cell mattress/frame/pillow stages,
stove/worktop/hood stages, tablecloth/seat/backrest stages, shower fittings
and screens. keep silhouettes, access and occupied-seat poses readable.
training purchases need a small visible training marker, not an invented
room or obstruction. measure actual calls, triangles and resources after
authoring. test camera extremes and both orientations in both engines.
the occupied-bed pass also found that existing home sleepers faced away
from their pillow and hung beyond the mattress. correct that display
transform for home sleep as a separate renderer delta. care alignment
stays intact. simulation seats, paths, headings, served/recovery values
and world coordinates do not move. awake residents keep their ordinary
standing/walking transform.

delivery: room effects + their working art first, staff training separately
if the review gets broad. before runtime edits, agree the minimal engine/
types hunk with the P1.1 owner. exact-head review, old-capture restore,
one paid purchase per chain and real timer/travel/stack probes precede
release. price labels must say the real effect and stay readable. measure
fresh and maxed active-service profiles too before claiming a faster economy.

### staff-training candidate

the four new pad unlocks carry helperSpeed100/115 or helperCarry5/6. the engine
derives the last bought value from content, with released85/4 fallbacks. no
new world/save field stores a tier or a derived rate. walking applies to all
six hired kinds and the escort's following line. actual fixed-step travel is
tested for each kind, including the clerk and collector. carry affects only
the hired cook's stove fill limit and its decision to leave with a full stack.
the player's speed, line and stack, unescorted residents, collector cash,
ordinary need settings, configured income rewards and service timers stay unchanged.

the two existing-footprint floor markers show one/two/three pace chevrons and
the cook's actual four/five/six trays. they reuse the scene's batched boxes
and colours, add no collision geometry, and persist after the price pads are
bought. goal labels state the capability, with dedicated narrow-phone checks
under the served CSP. no measured payback or faster-economy claim is made.

## acceptance and save gates

- C1: first warning, cancellation/revalidation, active riot, manual hold at
  every unlock stage, one reward and recovery with no/locked/full hospital.
- C2: initial2/upgrade4 seats, real resident arrival/use/home, simultaneous
  reservations, partial treatment, full fallback, done-in-care and preserved
  home/served value. both jails and current-only reset/travel/reload.
- G1: actual response journey, player+guard in range, interrupted hold,
  cancellation, restore, exactly one purchased responder and unchanged escorts.
- captured old saves: full purchases, partial payments, occupied rooms,
  two/three escorts, collector bag/safe, dirt, active fairy/mount and stamped
  departures. preserve all value and waypoints through repeated restores.
- route probes include collision, not just a returned endpoint: the router
  can fall back to a direct target when no grid path exists. inspect medical
  routes, old services and gate/release flow as actors actually walk them.
- real phone-sized portrait/landscape contexts, both engines, low/high tilt,
  zoom extremes, reduced motion, hidden/menu freeze and update acceptance.
  say explicitly which checks were emulated and which used a physical device.
- regressions must fail the relevant mutant. intermediate payment states are
  held by fixture resources, not sampled hopefully. transient presentations
  are observed on their own frame clock, not a later wall-time read.
- exact reviewed head, hosted green, built-output notices/leak check and
  independent production identity/byte/journey receipt before close-out.

## references and limits

[Prison Life's developer listing](https://play.google.com/store/apps/details?id=io.supercent.prison)
confirms the rooms/staff/upgrade family. [Codigames' own guidance](https://codigames.helpshift.com/hc/en/6-prison-empire-tycoon/faq/418-tips-to-succeed-at-your-prisons/?l=en)
is a secondary reference for distinct cell/service improvements. these inform
the genre direction, not our exact layouts, prices or recovery rules above.
the contract is an original design. its tuning still needs measured play.
