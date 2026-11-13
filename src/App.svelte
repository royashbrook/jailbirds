<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { capacity, DT, followers, freeBeds, hint, player, rankNeed, step } from "./engine/sim.ts";
  import { cues, gains, snap } from "./engine/cues.ts";
  import type { Stick, World } from "./engine/types.ts";
  import { LEVELS, MAP, PICKED, WORDS, hintText } from "./content/jail.ts";
  import { SCORE } from "./content/sound.ts";
  import { skinById } from "./skins/index.ts";
  import { createView, remember, type Past } from "./view/view.ts";
  import { createOverlay, type Thumb } from "./view/overlay.ts";
  import { CAMERA_CONTROLS, DEFAULT_CAMERA, cameraDrag, cameraPinch, cameraSettings, cameraStick, cameraWheel, type CameraSettings } from "./view/camera.ts";
  import { readJson, tryReadSlot, writeJson, writeSlot } from "./lib/storage.ts";
  import { MAP_KEY, load, rows, save as saveMap, startOver, travel, unlockNext, type Atlas, type Row } from "./lib/map.ts";
  import { createSound } from "./lib/sound.ts";
  import { installControl } from "./install.ts";
  import { updateControl, type UpdateCheck } from "./pwa.ts";
  // the drawn name: a striped bird and the word, no font file to load
  import wordmark from "./lib/wordmark.svg?raw";

  const ETHOS =
    "no ads, no lives, no timers, nothing to buy, no accounts, no cookies, nothing sold or shared.";
  // every jail on the map is one saved record (lib/map.ts): a blocked store just means "not saving"
  const store = { read: tryReadSlot, write: writeSlot };
  const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
  const opened = load(store, LEVELS, freshSeed());
  let atlas: Atlas = opened.atlas;
  // the open jail's world, the one played and drawn. always the same object as atlas.world
  let world: World = atlas.world;
  const level = () => LEVELS[world.level];
  // the look: one skin for now (peg people); the view draws whatever the skin describes
  const skin = skinById(null);
  const CAMERA = "jailbirds:camera";
  let camera = $state.raw(cameraSettings(readJson(CAMERA, DEFAULT_CAMERA)));
  let cameraSaved = $state(true);
  function saveCamera() {
    cameraSaved = writeJson(CAMERA, camera);
  }
  function adjustCamera(key: keyof CameraSettings, value: number) {
    camera = cameraSettings({ ...camera, [key]: value });
  }
  function resetCamera() {
    camera = { ...DEFAULT_CAMERA };
    saveCamera();
  }
  function closeSheet() {
    if (sheet === "camera") saveCamera();
    if (sheet === "level") levelUps = levelUps.slice(1);
    if (sheet === "unlocked") news = "";
    // what waits its turn comes up next: level ups one at a time, then a jail just unlocked
    // and a tab that has stopped saving keeps saying so: nothing goes on here until play here
    const waiting = elsewhere ? "elsewhere" : levelUps.length ? "level" : news ? "unlocked" : "";
    if (waiting) {
      sheet = waiting;
      if (dialog && !dialog.open) dialog.showModal();
      return;
    }
    sheet = "";
    grabs.clear();
    grabFrom = null;
  }

  // moving the view by hand while its sheet is up: one finger or the mouse turns and
  // tilts it, two fingers pinch to zoom, a wheel or trackpad scrolls to zoom. each
  // gesture counts from where it began, so nothing drifts, and it is kept when it ends.
  const grabs = new Map<number, { x: number; y: number }>();
  let grabFrom: { camera: CameraSettings; x: number; y: number; apart: number } | null = null;
  const onCard = (e: Event) => !!(e.target as Element | null)?.closest?.(".card");
  function grabbed() {
    const pts = [...grabs.values()];
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length, y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return { x, y, apart: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0 };
  }
  function grabDown(e: PointerEvent) {
    if (sheet !== "camera" || onCard(e)) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    grabs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    grabFrom = { camera, ...grabbed() };
  }
  function grabMove(e: PointerEvent) {
    if (!grabFrom || !grabs.has(e.pointerId)) return;
    grabs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = grabbed(), from = grabFrom;
    const turned = cameraDrag(from.camera, now.x - from.x, now.y - from.y, innerHeight);
    camera = grabs.size > 1 ? cameraPinch(turned, from.apart, now.apart) : turned;
  }
  function grabUp(e: PointerEvent) {
    if (!grabs.delete(e.pointerId)) return;
    if (grabs.size) grabFrom = { camera, ...grabbed() };
    else {
      grabFrom = null;
      saveCamera();
    }
  }
  function grabWheel(e: WheelEvent) {
    if (sheet !== "camera" || onCard(e)) return;
    e.preventDefault();
    camera = cameraWheel(camera, e.deltaY);
    // a drag still going counts on from here, or its next move would undo the zoom
    if (grabFrom) grabFrom = { camera, ...grabbed() };
    saveCamera();
  }

  // what the screen watches; the world mutates in place
  let coins = $state(world.coins);
  let crowd = $state("");
  let rank = $state(world.rank);
  let stars = $state(0);
  let need = $state(1);
  let lineNow = $state(0);
  let lineMax = $state(world.lineMax);
  let boosted = $state(0);
  // a count that just went up gives a little jump: each jump is a new number here
  let coinJump = $state(0);
  let starJump = $state(0);
  // short cheers that pop up and fade: a level up, a squabble settled, a boost
  let cheer = $state("");
  let cheerKey = $state(0);
  let cheerTimer: ReturnType<typeof setTimeout>;
  function shout(text: string) {
    cheer = text;
    cheerKey++;
    clearTimeout(cheerTimer);
    cheerTimer = setTimeout(() => (cheer = ""), 2400);
  }
  // `paid` is what the sim has paid out for level ups so far, so a new one reads what it paid
  const seenOf = (w: World) => ({ rank: w.rank, settled: w.settled, picked: w.picked.n, paid: w.took.rank });
  let seen = seenOf(world);
  // music and sounds: both on unless someone turned them off, each with its own
  // switch. nothing is heard before the first touch, the browser sees to that
  const SOUND = "jailbirds:sound";
  const kept = readJson<{ music?: unknown; sfx?: unknown }>(SOUND, {});
  const on = { music: kept.music !== false, sfx: kept.sfx !== false };
  let music = $state(on.music);
  let sounds = $state(on.sfx);
  const sound = createSound(SCORE, on);
  // how the jail looked when it was last listened to
  let before = snap(world);
  function setMusic(v: boolean) {
    music = v;
    sound.setMusic(v);
    writeJson(SOUND, { music, sfx: sounds });
  }
  function setSounds(v: boolean) {
    sounds = v;
    sound.setSfx(v, { kind: "coin", n: 1 });
    writeJson(SOUND, { music, sfx: sounds });
  }
  let place = $state(level().name);
  let tip = $state("");
  let saved = $state(opened.saved);
  // this tab has stopped saving because another has the map now: it stays told until play here
  let elsewhere = $state(false);
  let sheet = $state<"" | "about" | "camera" | "ios" | "restart" | "level" | "map" | "unlocked" | "elsewhere">("");
  // the map as listed when it was opened, a jail just unlocked waiting to be told, and why a trip did not go
  let jails = $state<Row[]>([]);
  let news = $state("");
  let travelNote = $state("");
  const placeName = (id: string) => MAP.find((p) => p.id === id)?.name ?? id;
  // a level up gets its own window: the new level, the money it paid, and a big ok. it is a
  // sheet like any other, so the jail holds still behind it. two at once wait their turn
  let levelUps = $state<{ rank: number; reward: number }[]>([]);
  function levelUp(from: number, to: number, reward: number, paid: number) {
    // one level up shows what the sim paid for it. more than one between two looks splits
    // that by what the sim pays per rank (sim.ts addStar): the reward times the new rank
    for (let r = from + 1; r <= to; r++) levelUps.push({ rank: r, reward: to - from === 1 ? paid : reward * r });
    if (!sheet) sheet = "level";
  }
  let noGl = $state(false);

  let canvasEl = $state<HTMLCanvasElement>();
  let overlayEl = $state<HTMLDivElement>();
  let surfaceEl = $state<HTMLDivElement>();
  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    if (dialog && !dialog.open) dialog.showModal();
  });
  // a wheel must be held back from the page, so it cannot be a passive listener
  $effect(() => {
    const d = dialog;
    if (!d) return;
    d.addEventListener("wheel", grabWheel, { passive: false });
    return () => d.removeEventListener("wheel", grabWheel);
  });

  // a read-only window onto the jail, for tests and the curious
  (window as unknown as { __jailbirds: unknown }).__jailbirds = {
    state: () => JSON.parse(JSON.stringify(world)) as World,
    skin: () => skin.id,
    rank: () => world.rank,
    camera: () => ({ ...camera }),
    drawn: () => (view ? { webgl: true, frames, ...view.info() } : { webgl: false, frames }),
    warden: () => (view ? view.where(world, { x: 0, y: 0, on: false }) : null),
    sound: () => sound.report(),
    pops: () => overlay?.shown() ?? null,
    map: () => ({ active: atlas.active, unlocked: [...atlas.unlocked] }),
  };

  function sync() {
    const l = level();
    coins = world.coins;
    crowd = `${capacity(world, l) - freeBeds(world, l)}/${capacity(world, l)}`;
    rank = world.rank;
    stars = world.stars;
    need = rankNeed(world, l);
    lineNow = followers(world, player(world)).length;
    lineMax = world.lineMax;
    boosted = Math.ceil(world.boosted);
    sound.cues(cues(before, world, l));
    // and for the eyes: a "+3" off the warden, a jump in the count, a ring where a pad was bought
    const got = gains(before, world);
    if (got.coins) {
      overlay?.gain("coin", got.coins);
      coinJump++;
    }
    if (got.stars) {
      overlay?.gain("star", got.stars);
      starJump++;
    }
    for (const id of got.bought) {
      const at = l.pads.find((p) => p.id === id)?.at;
      if (at) overlay?.ring(at.x, at.y);
    }
    before = snap(world);
    // the tune hurries along with the skates
    sound.pace(world.boosted > 0 ? 1.12 : 1);
    // and takes on a beat that will not settle while there is a squabble
    sound.trouble(world.alert !== null);
    if (world.rank > seen.rank) levelUp(seen.rank, world.rank, l.rankReward, world.took.rank - seen.paid);
    else if (world.settled > seen.settled) shout("all calm again! +money");
    // a surprise picked up says what it was
    else if (world.picked.n > seen.picked) shout(PICKED[world.picked.kind]);
    seen = seenOf(world);
    // the next jail pad paid for: the jail it opens goes on the map, saved now, and she is told once
    // any level up has had its turn. she stays here until she goes
    const unlocked = unlockNext(atlas, LEVELS);
    if (unlocked) {
      news = unlocked;
      travelNote = "";
      save();
      if (!sheet) sheet = "unlocked";
    }
    place = l.name;
    tip = hintText(hint(world, l), skin.noun);
  }
  sync();
  /** save now, in this call: for pagehide and the like, where a lock could not be waited for. the
   * write count check in lib/map.ts still stops a tab that is behind */
  function saveNow() {
    saved = saveMap(store, atlas);
    behind();
  }
  /** save under the cross-tab lock where the browser has one, so two of these saves never read, check
   * and write at once. the synchronous ones (saveNow) take no lock and lean on the write count alone.
   * play never waits on it, and without locks it is saveNow */
  function save() {
    locked(saveNow);
  }
  function locked(fn: () => void) {
    if (!("locks" in navigator) || !navigator.locks) return fn();
    let ran = false;
    const once = () => {
      if (ran) return;
      ran = true;
      fn();
    };
    navigator.locks.request(MAP_KEY, once).catch(once);
  }
  /** another tab has saved the map since this one looked, or the store answered only after this one
   * opened blind: lib/map.ts writes nothing more from this tab. she is told, and play here loads it */
  function behind() {
    if (!atlas.stale || elsewhere) return;
    elsewhere = true;
    sheet = "elsewhere";
  }
  /** a write to the map from another tab: stop saving from this one at once, before any save path
   * (the timer, hiding the page, leaving it) can put this tab's older jail over it */
  function onStorage(e: StorageEvent) {
    if (e.key !== MAP_KEY && e.key !== null) return;
    atlas.stale = true;
    behind();
  }

  /** another world is in play now: nothing seen, heard, held or drawn of the last one carries over, so
   * no stale cheer, coin or stamp comes from it. a level up still waiting is kept for its turn */
  function switched() {
    past.clear();
    thumb = null;
    pointer = null;
    keys.clear();
    tapped.clear();
    acc = 0;
    view?.reset();
    overlay?.reset();
    clearTimeout(cheerTimer);
    cheer = "";
    before = snap(world);
    seen = seenOf(world);
    sync();
  }

  /** start over: only the jail she is in. the map, what is unlocked and the other jails stay */
  function restart() {
    startOver(atlas, LEVELS, freshSeed());
    world = atlas.world;
    save();
    switched();
  }

  function openMap() {
    jails = rows(atlas, MAP);
    travelNote = "";
    sheet = "map";
  }
  /** go to another jail. the one she leaves is saved first, with the trip, in one write; if that
   * does not stick she stays, so nothing unsaved is ever left behind */
  function go(id: string) {
    locked(() => goNow(id));
  }
  function goNow(id: string) {
    // a second tap queued behind the first finds her there already
    if (id === atlas.active) return;
    const next = travel(store, atlas, LEVELS, id, freshSeed());
    if (!next) {
      saved = false;
      travelNote = "can't go yet: this browser is not saving your jail";
      behind();
      return;
    }
    atlas = next;
    world = next.world;
    saved = true;
    travelNote = "";
    news = "";
    switched();
    shout(`welcome to ${level().name}!`);
    sheet = levelUps.length ? "level" : "";
  }

  // input: a thumb stick wherever the finger goes down, or arrows and wasd
  const STICK = 44;
  let thumb: Thumb = null;
  let pointer: number | null = null;
  const keys = new Set<string>();
  // a key pressed and let go between two frames still counts for the next one:
  // on a slow device a quick tap must not vanish
  const tapped = new Set<string>();
  const held = (k: string) => keys.has(k) || tapped.has(k);
  function stick(): Stick {
    if (thumb) {
      const dx = (thumb.x - thumb.ox) / STICK, dy = (thumb.y - thumb.oy) / STICK;
      return cameraStick({ x: dx, y: dy }, camera.turn);
    }
    const x = (held("right") ? 1 : 0) - (held("left") ? 1 : 0);
    const y = (held("down") ? 1 : 0) - (held("up") ? 1 : 0);
    return cameraStick({ x, y }, camera.turn);
  }
  function local(e: PointerEvent) {
    const box = canvasEl!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }
  function down(e: PointerEvent) {
    if (pointer !== null || sheet || !canvasEl) return;
    pointer = e.pointerId;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = local(e);
    thumb = { ox: p.x, oy: p.y, x: p.x, y: p.y, r: STICK };
  }
  function move(e: PointerEvent) {
    if (e.pointerId !== pointer || !thumb) return;
    const p = local(e);
    // the knob stays on the ring; past it the base follows the finger
    const dx = p.x - thumb.ox, dy = p.y - thumb.oy, d = Math.hypot(dx, dy);
    if (d > STICK) {
      thumb.ox = p.x - (dx / d) * STICK;
      thumb.oy = p.y - (dy / d) * STICK;
    }
    thumb.x = p.x;
    thumb.y = p.y;
  }
  function up(e: PointerEvent) {
    if (e.pointerId !== pointer) return;
    pointer = null;
    thumb = null;
  }
  const KEYS: Record<string, string> = {
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right",
    ArrowUp: "up", w: "up", W: "up",
    ArrowDown: "down", s: "down", S: "down",
  };
  function keydown(e: KeyboardEvent) {
    const k = KEYS[e.key];
    if (!k || sheet) return;
    e.preventDefault();
    keys.add(k);
    tapped.add(k);
  }
  function keyup(e: KeyboardEvent) {
    const k = KEYS[e.key];
    if (k) keys.delete(k);
  }
  const blur = () => {
    keys.clear();
    tapped.clear();
  };
  $effect(() => {
    if (sheet) {
      keys.clear();
      tapped.clear();
      thumb = null;
      pointer = null;
    }
  });

  // the 3d view fills its space; the renderer caps the pixel ratio at 2
  let view: ReturnType<typeof createView> | null = null;
  let overlay: ReturnType<typeof createOverlay> | null = null;
  let cssW = 1;
  let cssH = 1;
  function fit() {
    if (!surfaceEl) return;
    const box = surfaceEl.getBoundingClientRect();
    cssW = Math.max(1, box.width);
    cssH = Math.max(1, box.height);
    view?.resize(cssW, cssH);
  }

  // real time in, fixed steps out. a hidden page or an open sheet holds the jail still.
  const past: Past = new Map();
  let frames = 0;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let sinceSave = 0;
  function frame(now: number) {
    const dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
    last = now;
    if (!sheet && !document.hidden) {
      acc += dt;
      const stepsBefore = world.steps;
      while (acc >= DT) {
        remember(world, past);
        step(world, LEVELS, stick());
        acc -= DT;
      }
      // a tap has had its frame of steps once any step ran
      if (world.steps !== stepsBefore) tapped.clear();
      sinceSave += dt;
      if (sinceSave > 2) {
        sinceSave = 0;
        save();
      }
      sync();
    }
    if (view && overlay) {
      view.render(world, level(), past, sheet ? 1 : acc / DT, now, dt, camera);
      overlay.update(world, level(), view, skin, WORDS, thumb, cssW, cssH, now);
      frames++;
    }
    raf = requestAnimationFrame(frame);
  }
  const visibility = () => {
    last = 0;
    if (document.hidden) saveNow();
    sound.quiet(document.hidden);
  };
  const pagehide = () => {
    saveNow();
    sound.quiet(true);
  };
  // back from the page cache, where pagehide left it quiet
  const pageshow = () => sound.quiet(document.hidden);
  // a browser lets sound start only on a touch, a click or a key, and may say no
  // to any one of them, so every one asks. a finger going down is not one of them
  const WAKES = ["pointerdown", "pointerup", "touchend", "click", "keydown"];
  const wake = (e: Event) => {
    if (e.type === "pointerdown" && (e as PointerEvent).pointerType !== "mouse") return;
    sound.wake();
  };

  let installVisible = $state(false);
  let updateReady = $state(false);
  let updateNote = $state("");
  let install: ReturnType<typeof installControl>;
  let updates: ReturnType<typeof updateControl>;
  async function checkUpdate() {
    updateNote = "checking...";
    const result: UpdateCheck = await updates.check();
    updateNote = result === "current" ? "you have the newest jailbirds" : result === "newer" ? "a new version is ready" : "could not check right now";
  }
  async function applyUpdate() {
    try {
      saveNow();
      await updates.apply();
    } catch {
      updateNote = "the update did not finish. try again in a moment";
    }
  }

  let observer: ResizeObserver | undefined;
  let dark: MediaQueryList | undefined;
  const repaint = () => view?.setDark(dark?.matches ?? false);
  onMount(() => {
    // no webgl (an old browser, a locked-down device): the shell still works and says so
    try {
      if (canvasEl) view = createView(canvasEl, skin);
      if (overlayEl) overlay = createOverlay(overlayEl);
    } catch {
      view = null;
      noGl = true;
    }
    install = installControl((v) => (installVisible = v), () => (sheet = "ios"));
    updates = updateControl(() => (updateReady = true));
    addEventListener("keydown", keydown);
    addEventListener("keyup", keyup);
    addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    addEventListener("pagehide", pagehide);
    addEventListener("storage", onStorage);
    addEventListener("pageshow", pageshow);
    for (const type of WAKES) addEventListener(type, wake, { capture: true, passive: true });
    dark = matchMedia("(prefers-color-scheme: dark)");
    dark.addEventListener("change", repaint);
    repaint();
    observer = new ResizeObserver(fit);
    if (surfaceEl) observer.observe(surfaceEl);
    fit();
    raf = requestAnimationFrame(frame);
  });
  onDestroy(() => {
    install?.dispose();
    updates?.dispose();
    observer?.disconnect();
    dark?.removeEventListener("change", repaint);
    cancelAnimationFrame(raf);
    sound.quiet(true);
    view?.dispose();
    if (typeof removeEventListener === "function") {
      removeEventListener("keydown", keydown);
      removeEventListener("keyup", keyup);
      removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      removeEventListener("pagehide", pagehide);
      removeEventListener("storage", onStorage);
      removeEventListener("pageshow", pageshow);
      for (const type of WAKES) removeEventListener(type, wake, { capture: true });
    }
  });
</script>

<main class="play">
  <header class="hud">
    <div class="top">
      <span class="logo">{@html wordmark}</span>
      <span class="corner"><span id="version">v{__APP_VERSION__}</span><br /><span id="place">{place}</span></span>
    </div>
    <div class="stats">
      <div class="stat" id="coins" aria-label={`money: $${coins}`}><svg class="money-mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2" /><ellipse cx="12" cy="12" rx="3.5" ry="3" /></svg>{#key coinJump}<b class:jump={coinJump > 0}>{coins}</b>{/key}</div>
      <div class="stat" id="line" aria-label={`leading ${lineNow} of ${lineMax}`}><span>line</span><b class:full={lineNow >= lineMax}>{lineNow}/{lineMax}</b></div>
      <div class="stat" id="crowd"><span>beds</span><b>{crowd}</b></div>
      <div class="rank" id="rank" role="img" aria-label={`level ${rank}, ${stars} of ${need} stars to the next`}>
        {#key starJump}<svg class="badge" class:jump={starJump > 0} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.2 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" /></svg>{/key}
        <b>{rank}</b>
        <span class="bar"><span class="fill" style:width={`${(100 * stars) / need}%`}></span></span>
        <small>{stars}/{need}</small>
      </div>

    </div>
  </header>
  <div
    class="surface"
    role="application"
    aria-label="the jail: drag anywhere to walk the warden. arrow keys or wasd walk too."
    bind:this={surfaceEl}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onlostpointercapture={up}
  >
    <canvas id="jail" bind:this={canvasEl}></canvas>
    <div class="overlay" bind:this={overlayEl}></div>
    {#if noGl}<p class="nogl" role="status">this browser cannot draw the jail in 3d</p>{/if}
    {#if boosted > 0}<div class="zoom" id="boost">zoom! {boosted}s</div>{/if}
    {#key cheerKey}{#if cheer}<div class="cheer" role="status">{cheer}</div>{/if}{/key}
  </div>
  <footer class="foot">
    <p class="tip" id="tip">{#if !saved}<span class="warn">this browser is not saving your jail</span>{:else}{tip}{/if}</p>
    <nav class="nav" aria-label="jailbirds">
      <button id="about" aria-label="menu and about" onclick={() => (sheet = "about")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" /></svg>menu</button>
      <button id="map" aria-label="map of jails" onclick={openMap}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></svg>map</button>
      <button id="camera" aria-label="adjust camera" disabled={noGl} onclick={() => (sheet = "camera")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l1-2h6l1 2h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /><circle cx="12" cy="12" r="4" /></svg>view</button>
    </nav>
  </footer>
</main>

{#if updateReady}<button class="update" onclick={applyUpdate}>new version, tap to load</button>{/if}

{#if sheet}
  <dialog bind:this={dialog} class="sheet" class:camera-sheet={sheet === "camera"} onclose={closeSheet} onpointerdown={grabDown} onpointermove={grabMove} onpointerup={grabUp} onpointercancel={grabUp}>
    <div class="card" class:camera-card={sheet === "camera"} class:level-card={sheet === "level"}>
      {#if sheet === "camera"}
        <div class="camera-heading"><h2>your view</h2><span>paused</span></div>
        <p class="camera-how">drag the jail to turn it. pinch or scroll to zoom.</p>
        {#each CAMERA_CONTROLS as control (control.key)}
          <label class="camera-control" for={`camera-${control.key}`}>
            <span>{control.label}</span>
            <input id={`camera-${control.key}`} type="range" min={control.min} max={control.max} step={control.step} value={camera[control.key]} oninput={(e) => adjustCamera(control.key, e.currentTarget.valueAsNumber)} onchange={saveCamera} />
            <output for={`camera-${control.key}`}>{control.key === "zoom" ? `${Math.round(camera.zoom * 100)}%` : `${Math.round(camera[control.key])}°`}</output>
          </label>
        {/each}
        {#if !cameraSaved}<p class="warn camera-note" role="status">this browser is not saving your view</p>{/if}
        <div class="row camera-actions">
          <button id="reset-camera" onclick={resetCamera}>reset view</button>
          <button id="close" class="big" onclick={closeSheet}>done</button>
        </div>
      {:else if sheet === "about"}
        <h2 class="title">{@html wordmark}</h2>
        {#if updateReady}<button class="big" onclick={applyUpdate}>load new version</button>{/if}
        <div class="row">
          <button id="music" role="switch" aria-checked={music} onclick={() => setMusic(!music)}>music: {music ? "on" : "off"}</button>
          <button id="sounds" role="switch" aria-checked={sounds} onclick={() => setSounds(!sounds)}>sounds: {sounds ? "on" : "off"}</button>
        </div>
        <p>you are the warden. drag anywhere to walk (arrow keys work too). everything else happens when you walk onto it.</p>
        <p>new {skin.noun} come by bus and line up at intake. stand behind the desk to check them in (they get orange shirts), then stand by them a moment and they follow you. lead them to a cell with a free bed.</p>
        <p>a bubble over someone means they want something: walk to their cell and lead them to the canteen or the showers. tables need trays from the kitchen. toilets in the cells get messy: walk over a mess to clean it. happy {skin.noun} drop money, and so do the desks.</p>
        <p>when one has served their time a key pops up over them: lead them to the release desk to set them free. each one set free earns a star, and stars fill your level. price tags with a lock open at a higher level.</p>
        <p>now and then two start a squabble: run over to calm them down. and keep an eye out for free skates, they make you zoom.</p>
        <p>pay the next jail price tag to open a new jail on the map. tap map to go between your jails: each one keeps going right where you left it.</p>
        <p class="ethos">{ETHOS}</p>
        <p class="version">version {__APP_VERSION__}</p>
        <div class="row">
          <button onclick={checkUpdate}>check for update</button>
          {#if installVisible}<button id="install" onclick={() => install.prompt()}>install</button>{/if}
        </div>
        {#if updateNote}<p role="status">{updateNote}</p>{/if}
        <div class="row"><button id="restart" onclick={() => (sheet = "restart")}>start over</button></div>
        <p><a class="licences" href="/licenses.md" target="_blank" rel="noopener">licences</a></p>
        <p class="maker">made with <svg aria-hidden="true" class="mark-heart" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg><span class="sr">love</span> by
          <a href="https://royashbrook.com" target="_blank" rel="noopener">roy</a> +
          <a href="https://royashbrook.com/agents" target="_blank" rel="noopener">ai</a>
          <span class="mark-tail"><span aria-hidden="true" class="mark-dot">·</span>
          <a href="https://github.com/sponsors/royashbrook" target="_blank" rel="noopener">sponsor me</a></span></p>
      {:else if sheet === "restart"}
        <h2>start {place} over?</h2>
        <p>this jail, your {skin.noun} and your money here all go away. the map and your other jails stay as they are.</p>
        <button id="confirm-restart" class="big" onclick={() => { sheet = ""; restart(); }}>start over</button>
      {:else if sheet === "map"}
        <h2>map</h2>
        <ul class="jails" id="jails">
          {#each jails as j (j.id)}
            <li class="jail" class:here={j.state === "here"} class:later={j.state === "later"} data-jail={j.id} data-state={j.state}>
              <span class="jail-name">{j.name}</span>
              {#if j.state === "here"}<span class="jail-note">you are here</span>
              {:else if j.state === "open"}<button class="go" onclick={() => go(j.id)}>go</button>
              {:else if j.state === "locked"}<span class="jail-note"><svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>locked</span>
              {:else}<span class="jail-note">coming later</span>{/if}
            </li>
          {/each}
        </ul>
        {#if travelNote}<p class="warn" role="status">{travelNote}</p>{/if}
      {:else if sheet === "unlocked"}
        <h2 id="unlocked-title">new jail unlocked!</h2>
        <p>{placeName(news)} is on the map now.</p>
        {#if travelNote}<p class="warn" role="status">{travelNote}</p>{/if}
        <button id="go-now" class="big" onclick={() => go(news)}>go now</button>
        <button id="later" onclick={closeSheet}>later</button>
      {:else if sheet === "elsewhere"}
        <h2 id="elsewhere-title">your jail is open somewhere else</h2>
        <p>this one has stopped saving, so nothing here goes over it.</p>
        <button id="play-here" class="big" onclick={() => location.reload()}>play here</button>
      {:else if sheet === "ios"}
        <h2>install jailbirds</h2>
        <p>in safari, tap the <b>share</b> button, then <b>add to home screen</b>.</p>
      {:else if sheet === "level" && levelUps[0]}
        <div class="level-up" id="level-up" role="status">
          <div class="confetti" aria-hidden="true">{#each { length: 14 } as _, i (i)}<i style:--i={i}></i>{/each}</div>
          <div class="level-stars" aria-hidden="true">{#each [0, 1, 2] as k (k)}<svg viewBox="0 0 24 24" style:--k={k}><path d="M12 2.5l2.9 6.2 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" /></svg>{/each}</div>
          <h2 id="level-title">level {levelUps[0].rank}!</h2>
          <p class="level-reward" id="level-reward">+${levelUps[0].reward}</p>
          <!-- svelte-ignore a11y_autofocus -->
          <button id="level-ok" class="big" autofocus onclick={closeSheet}>ok</button>
        </div>
      {/if}
      {#if sheet !== "camera" && sheet !== "level" && sheet !== "unlocked" && sheet !== "elsewhere"}<button id="close" class="big" onclick={closeSheet}>{sheet === "restart" ? "keep playing" : "back"}</button>{/if}
    </div>
  </dialog>
{/if}
