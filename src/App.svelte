<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { capacity, create, DT, followers, freeBeds, hint, player, rankNeed, restore, step } from "./engine/sim.ts";
  import type { Stick, World } from "./engine/types.ts";
  import { LEVELS, WORDS, hintText } from "./content/jail.ts";
  import { skinById } from "./skins/index.ts";
  import { createView, remember, type Past } from "./view/view.ts";
  import { createOverlay, type Thumb } from "./view/overlay.ts";
  import { CAMERA_CONTROLS, DEFAULT_CAMERA, cameraSettings, cameraStick, type CameraSettings } from "./view/camera.ts";
  import { readJson, readSlot, writeJson, writeSlot } from "./lib/storage.ts";
  import { installControl } from "./install.ts";
  import { updateControl, type UpdateCheck } from "./pwa.ts";
  // the drawn name: a striped bird and the word, no font file to load
  import wordmark from "./lib/wordmark.svg?raw";

  const ETHOS =
    "no ads, no lives, no timers, nothing to buy, no accounts, no cookies, nothing sold or shared.";
  // the whole jail is one saved record: a blocked store just means "not saving"
  const SAVE = "jailbirds:save";
  const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
  let world: World = restore(readSlot(SAVE), LEVELS) ?? create(LEVELS, 0, freshSeed());
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
    sheet = "";
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
  let seen = { rank: world.rank, settled: world.settled, level: world.level, boosted: world.boosted };
  let place = $state(level().name);
  let tip = $state("");
  let saved = $state(true);
  let sheet = $state<"" | "about" | "camera" | "ios" | "restart">("");
  let noGl = $state(false);

  let canvasEl = $state<HTMLCanvasElement>();
  let overlayEl = $state<HTMLDivElement>();
  let surfaceEl = $state<HTMLDivElement>();
  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    if (dialog && !dialog.open) dialog.showModal();
  });

  // a read-only window onto the jail, for tests and the curious
  (window as unknown as { __jailbirds: unknown }).__jailbirds = {
    state: () => JSON.parse(JSON.stringify(world)) as World,
    skin: () => skin.id,
    rank: () => world.rank,
    camera: () => ({ ...camera }),
    drawn: () => (view ? { webgl: true, frames, ...view.info() } : { webgl: false, frames }),
    warden: () => (view ? view.where(world, { x: 0, y: 0, on: false }) : null),
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
    if (world.level !== seen.level) shout(`welcome to ${l.name}!`);
    else if (world.rank > seen.rank) shout(`level up! level ${world.rank}, +${l.rankReward * world.rank} coins`);
    else if (world.settled > seen.settled) shout("all calm again! +coins");
    else if (world.boosted > seen.boosted + 1) shout("speed boost!");
    seen = { rank: world.rank, settled: world.settled, level: world.level, boosted: world.boosted };
    place = l.name;
    tip = hintText(hint(world, l), skin.noun);
  }
  sync();
  function save() {
    saved = writeSlot(SAVE, JSON.stringify(world));
  }

  function restart() {
    world = create(LEVELS, 0, freshSeed());
    past.clear();
    thumb = null;
    keys.clear();
    tapped.clear();
    save();
    sync();
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
      overlay.update(world, level(), view, skin, WORDS, thumb, cssW, cssH);
      frames++;
    }
    raf = requestAnimationFrame(frame);
  }
  const visibility = () => {
    last = 0;
    if (document.hidden) save();
  };
  const pagehide = () => save();

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
      save();
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
    view?.dispose();
    if (typeof removeEventListener === "function") {
      removeEventListener("keydown", keydown);
      removeEventListener("keyup", keyup);
      removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      removeEventListener("pagehide", pagehide);
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
      <div class="stat" id="coins" aria-label={`${coins} coins`}><svg class="coin-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /></svg><b>{coins}</b></div>
      <div class="stat" id="line" aria-label={`leading ${lineNow} of ${lineMax}`}><span>line</span><b class:full={lineNow >= lineMax}>{lineNow}/{lineMax}</b></div>
      <div class="stat" id="crowd"><span>beds</span><b>{crowd}</b></div>
      <div class="rank" id="rank" role="img" aria-label={`level ${rank}, ${stars} of ${need} stars to the next`}>
        <svg class="badge" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.2 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" /></svg>
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
      <button id="camera" aria-label="adjust camera" disabled={noGl} onclick={() => (sheet = "camera")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l1-2h6l1 2h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /><circle cx="12" cy="12" r="4" /></svg>view</button>
      <button id="restart" aria-label="start over" onclick={() => (sheet = "restart")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95" /><path d="M19.5 4v4h-4" /></svg>new jail</button>
    </nav>
  </footer>
</main>

{#if updateReady}<button class="update" onclick={applyUpdate}>new version, tap to load</button>{/if}

{#if sheet}
  <dialog bind:this={dialog} class="sheet" class:camera-sheet={sheet === "camera"} onclose={closeSheet}>
    <div class="card" class:camera-card={sheet === "camera"}>
      {#if sheet === "camera"}
        <div class="camera-heading"><h2>your view</h2><span>paused</span></div>
        {#each CAMERA_CONTROLS as control (control.key)}
          <label class="camera-control" for={`camera-${control.key}`}>
            <span>{control.label}</span>
            <input id={`camera-${control.key}`} type="range" min={control.min} max={control.max} step={control.step} value={camera[control.key]} oninput={(e) => adjustCamera(control.key, e.currentTarget.valueAsNumber)} onchange={saveCamera} />
            <output for={`camera-${control.key}`}>{control.key === "zoom" ? `${Math.round(camera.zoom * 100)}%` : `${camera[control.key]}°`}</output>
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
        <p>you are the warden. drag anywhere to walk (arrow keys work too). everything else happens when you walk onto it.</p>
        <p>new {skin.noun} come by bus and line up at intake. stand behind the desk to check them in (they get orange shirts), then walk up to them and they follow you. lead them to a cell with a free bed.</p>
        <p>a bubble over someone means they want something: walk to their cell and lead them to the canteen or the showers. tables need trays from the kitchen. toilets in the cells get messy: walk over a mess to clean it. happy {skin.noun} drop coins, and so do the desks.</p>
        <p>when one has served their time a key pops up over them: lead them to the release desk to set them free. each one set free earns a star, and stars fill your level. price tags with a lock open at a higher level.</p>
        <p>now and then two start a squabble: run over to calm them down. and keep an eye out for free skates, they make you zoom.</p>
        <p class="ethos">{ETHOS}</p>
        <p class="version">version {__APP_VERSION__}</p>
        <div class="row">
          <button onclick={checkUpdate}>check for update</button>
          {#if installVisible}<button id="install" onclick={() => install.prompt()}>install</button>{/if}
        </div>
        {#if updateNote}<p role="status">{updateNote}</p>{/if}
        <p><a class="licences" href="/licenses.md" target="_blank" rel="noopener">licences</a></p>
        <p class="maker">made with <svg aria-hidden="true" class="mark-heart" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg><span class="sr">love</span> by
          <a href="https://royashbrook.com" target="_blank" rel="noopener">roy</a> +
          <a href="https://royashbrook.com/agents" target="_blank" rel="noopener">ai</a>
          <span class="mark-tail"><span aria-hidden="true" class="mark-dot">·</span>
          <a href="https://github.com/sponsors/royashbrook" target="_blank" rel="noopener">sponsor me</a></span></p>
      {:else if sheet === "restart"}
        <h2>start over?</h2>
        <p>your jail, your {skin.noun} and your coins all go away.</p>
        <button id="confirm-restart" class="big" onclick={() => { sheet = ""; restart(); }}>start over</button>
      {:else if sheet === "ios"}
        <h2>install jailbirds</h2>
        <p>in safari, tap the <b>share</b> button, then <b>add to home screen</b>.</p>
      {/if}
      {#if sheet !== "camera"}<button id="close" class="big" onclick={closeSheet}>{sheet === "restart" ? "keep playing" : "back"}</button>{/if}
    </div>
  </dialog>
{/if}
