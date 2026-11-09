# jail growth and a place worth growing

working feature plan for #6. this is a sequence of playable releases, not a
claim that these systems already exist. camera and update-discovery follow-ups
are #8 and #9.

## what is missing now

at source f068cab, `src/content/jail.ts` creates both jails from one layout.
jail 2 doubles prices and increases coin frequency, then removes the next-jail
pad. its purchases are otherwise the same cells, tables, showers and four
one-time helpers. once they are bought, extra coins have no use. rank can keep
increasing without opening anything new.

the engine already has useful building blocks: locked rooms, stations and seats;
prerequisite purchase pads; needs; walking helpers; construction paid in coins;
and scene rebuilding after purchases. use those before adding another system.
the current carrier and clerk choose the first source/check-in station, so
multiple departments need explicit targeting before they can be called automated.
also, only the player currently collects room/desk coins and settles squabbles.
the existing hires automate chores, not the whole economy. those missing jobs
must be addressed before claiming a hands-off jail.

## reference, not a shopping list

the primary reference is [Supercent's Prison Life](https://play.google.com/store/apps/details?id=io.supercent.prison),
the walk-around arcade-idle game this project follows. its developer describes
room upgrades, staff, kitchens, gyms, mines, visiting rooms and away earnings.
keep that hands-on loop as the spine, with the map and distinct prisons as a
real progression target rather than another price multiplier.

[Prison Empire Tycoon](https://play.google.com/store/apps/details?hl=en_US&id=com.codigames.idle.prison.empire.manager.tycoon)
is a secondary reference for service chains and environment details, not a
reason to turn this into a different management game. laundry, library and
utilities are optional later ideas, not assumed Prison Life mechanics.
we copy no art, layout, currencies, paid boosters or waiting gates.

our direction: build a friendly little working diorama. start by doing a job,
hire someone to own it, improve their tools, then add a new room or wing that
makes another job worth doing. automated income funds the next visible target.

## release 1: make existing rooms worth improving

- a compact next-goal card: what can be built now, the cost and what it changes.
  distinguish a rank requirement from a coin shortage. after buying everything
  currently available, show the next real milestone rather than a vacant map.
- a hired cash collector that banks room and station earnings, and guard patrol
  training that settles squabbles. walking through cash stays satisfying before
  choosing to buy that automation. routine collection
  and incident response must work without the player walking every circuit.
  buying the next improvement remains the player's deliberate choice.
- three visible improvement stages for cells, kitchen/canteen and showers.
  better beds and room fittings improve comfort/income; kitchen equipment and
  serving capacity improve meal throughput; shower fittings improve capacity or
  service time. the affected number must be visible before purchase.
- staff training with visible equipment and real throughput/carry/speed effects.
  hire once, then improve the job rather than buying an identical helper forever.
- an end-of-current-content panel while the next expansion is being built.
  do not pretend an endlessly increasing rank unlocks unimplemented rewards.
- art in the same slice: bed frames, rounded mattresses, pillows, cupboard or
  shelf, lamps, tiled wet rooms, kitchen counters and recognizable serving gear.
  improve the wall caps, floor materials and room lighting at the same time.

acceptance: a returning maxed jail-2 save retains every purchase and coin and
immediately has a visible new goal. each tier changes both the rendered room and
the measured simulation outcome. automate a complete intake-to-release loop,
then buy another useful improvement with its income without manual busywork.
record purchase cadence from actual play; tune costs against that evidence.
split this into small reviews: goals and missing automation first, then room
tiers and staff equipment with their art. do not call the first slice a complete
progression overhaul while the remaining purchases are still unimplemented.

## release 2: a new prison on the map, with room to grow

- bring the site map and a genuinely different second prison forward. use clear
  star/achievement requirements, a new look and different room opportunities.
  preserve the current second jail as an existing site until migration is proven.
- retain each site's cash, workers and purchases and make switching sites explicit.
  decide and show any return-earnings calculation before introducing it. do not
  imply that a closed site is simulated continuously when it is not.

- authored expansion slots with a preview footprint and a labelled construction
  pad. buy a cell wing, dining extension or service annex in coins, then watch
  the actual furniture and room assemble into the space. no construction timer.
- keep room/station IDs stable. the slot contributes the existing room, station,
  seat and pad definitions instead of introducing a second simulation engine.
- helpers serve their assigned department or select an available matching job.
  two kitchens must not send every cook to the first stove or desk in the file.
- show how the new capacity changes the queue and earnings. the added population
  should create the next understandable capacity decision, not a silent jam.
- art in this slice: connecting corridors, fences, landscaping, utility fixtures,
  doors and a short build-in animation. readable silhouettes at distant zoom.

acceptance: visit and resume both sites, buy two different extensions, observe
different usable capacity, save/reload, and walk the new corridors. meals,
cleanup, escort and release keep working with multiple departments. no stranded
resident, unreachable station or lost balance after switching sites.

## release 3: more things happening inside

- phone room, recreation yard and work/mine area as distinct activities, followed
  by an infirmary and visiting room. give each a recognizable purpose and action.
- a work area that visibly produces something, with staff and an earned income
  target, not a decorative room that only increases a multiplier.
- an infirmary that adds a comprehensible care loop, not random punishment.
- an earned improvement should reduce a bottleneck. introduce one service at a
  time and keep existing residents viable while that service is being unlocked.
- integrate activity animations and material/detail improvements with each room.

acceptance: each new service has a distinct visible job, a staff assignment and a
measurable benefit. a fully automated jail can cover every required service.
no need starts depleting on an old save before its facility is reachable.

## release 4: deeper variety after the core rooms

- add more themed sites and longer-term workshop/visitor improvements.
- consider VIP residents, earned capacity boosts and bounded away earnings as
  separate reviewed features. preserve the no-ads/no-paid-gates contract.
- consider library, laundry or utilities only when they add a good new job.
  those are proposals, not a prerequisite for recognizing the original loop.
- distinct environment identity per site: courtyard layout, materials, surrounding
  landscape, furniture and working activity. not the same floor at twice the cost.

acceptance: an existing player can visit both sites, resume each one's workers
and purchases, and explain the next target without opening help. complete an
authored sequence of upgrades and expansion before calling a site finished.

## rails for every slice

- preserve installed saves, stable IDs and camera preferences. use captured
  old-version fixtures plus tests for fully upgraded and partially paid saves.
- keep visible human-sized goals after automation. no ads, premium currency,
  energy meters, forced waiting or deliberate shortages to sell a shortcut.
- keep original art. improve one coherent material family at a time rather than
  scattering decorative props that do not explain a room's purpose.
- retain shared meshes and bounded pools. compare render cost as the population
  and room count grow. a detailed screenshot is not proof of phone performance.
- check both orientations and the expanded camera range, including low angles.
  clear cutaways and labels matter more than decorative geometry hiding people.
- every release includes a before/after play journey, migration and updater proof,
  exact-head review, hosted tests and an independent live receipt.

next implementation slice: release 1. do not bundle the whole roadmap into one PR.
