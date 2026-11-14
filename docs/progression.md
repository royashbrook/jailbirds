# jail growth and a place worth growing

implementation contract for #6, #23, #34, #36 and #45. baseline: 0.1.121,
source64a0128. this is the current sequence, not a claim that unshipped features
exist. exact-head review and release checks apply to every slice.

## direction and what is already done

build a friendly, working jail diorama: do a job, hire help, improve the room,
then open a genuinely new place. keep the peg people, original low-poly art,
hands-on movement, both orientations and adjustable camera. no ads, premium
currency, paid rescue, deleted residents or progress resets.

the named map, per-jail saves, current-only reset, rubble cell reveals,
collector, extra escort guards, hygiene/unrest, stamp, sound and feedback are
already shipped. they are not future deliverables. pine hill and desert rock
still share a footprint. hospital care, riots, incident guards, room tiers,
distinct new layouts and the full environment pass remain ahead.

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
   clock for scheduling/cooldown, not a second event scheduler. preserve old
   alerts as squabbles when their new fields are absent.
2. riots start at rank3 or higher when an incident is due and at least3
   eligible residents in one block have unrest>=0.6. a block means its member
   houses, not one two-bed cell. select at most4 residents, stable id order.
   exclude followers, people in service/care/release, done residents and anyone
   already claimed. no participant can be claimed by two jobs.
3. warning lasts5 simulation seconds. reserve ids in the one alert, revalidate
   before activation, and cancel without a reward if fewer than3 remain
   eligible. ordinary services continue. pause, hidden state and inactive jails
   do not advance warning, unrest, recovery or cooldown.
4. current block rendezvous is (360,210), with small separated standing spots
   along that clear corridor. people walk there on existing routes, never
   teleport out of beds or through walls. the player can intervene while they
   gather. the alert marker points to this reachable anchor.
5. standing still within40 of the anchor calms a riot in3 contiguous simulation
   seconds. reset the hold when no valid responder is present. no response
   deadline removes residents, drains money or blocks unrelated intake/release.
   after resolution apply a30-second riot cooldown. keep ordinary squabble
   timing unchanged.
6. reward is the existing6 cash, once per resolved incident. remove the alert
   in the same simulation transition as reward/settled count. warning
   cancellation pays nothing. restore never resolves/rewards an event itself.
7. after a riot one remaining participant, lowest id, gets a comic bump. retain
   home, bed slot, served progress and identity. others return home on routes.
   clamp unrest down to at most0.3, never increase a calmer resident to0.3.
8. use one bounded recovery-work value, initially20 and zero when healthy.
   at home it falls by1 per simulation second, so recovery is always free.
   no separate random illness, health bar or continuously decaying medical need.
   a locked, absent or full hospital cannot suspend home recovery.
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
