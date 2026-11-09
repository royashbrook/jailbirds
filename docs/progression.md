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

## reference, not a shopping list

[Prison Empire Tycoon's developer listing](https://play.google.com/store/apps/details?hl=en_US&id=com.codigames.idle.prison.empire.manager.tycoon)
describes room improvements, recreation, healthcare, laundry, visits, utilities
and specialized staff. the useful design is that growing population creates a
new service problem, and investing in that service visibly changes the prison.
we do not copy its art, currencies, paid boosters or waiting gates.

our direction: build a friendly little working diorama. start by doing a job,
hire someone to own it, improve their tools, then add a new room or wing that
makes another job worth doing. automated income funds the next visible target.

## release 1: make existing rooms worth improving

- a compact next-goal card: what can be built now, the cost and what it changes.
  distinguish a rank requirement from a coin shortage. after buying everything
  currently available, show the next real milestone rather than a vacant map.
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

## release 2: snap in a real new wing

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

acceptance: buy two different extensions, observe different usable capacity,
save/reload, and walk the new corridors. meals, cleanup, escort and release keep
working with multiple departments. no stranded resident or unreachable station.

## release 3: more things happening inside

- recreation yard and library for activities, with benches, books and equipment.
- laundry and maintenance as visible service jobs, with stocked items and staff.
- a small clinic that adds a comprehensible care loop, not random punishment.
- an earned improvement should reduce a bottleneck. introduce one service at a
  time and keep existing residents viable while that service is being unlocked.
- integrate activity animations and material/detail improvements with each room.

acceptance: each new service has a distinct visible job, a staff assignment and a
measurable benefit. a fully automated jail can cover every required service.
no need starts depleting on an old save before its facility is reachable.

## release 4: a reason to run another jail

- a genuinely different second layout with space for the expansion system.
  preserve the current second jail as an existing site until migration is proven.
- add workshops and visits as new activities and longer-term funding targets.
- a site selector and a clear next-site requirement. retain built sites and their
  progress rather than quietly resetting the player's work when they travel.
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
