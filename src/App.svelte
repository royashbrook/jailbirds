<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { capacity, create, DT, followers, freeBeds, hint, player, rankNeed, restore, step } from "./engine/sim.ts";
  import type { Stick, World } from "./engine/types.ts";
  import { LEVELS, WORDS, hintText } from "./content/jail.ts";
  import { SKINS, skinById } from "./skins/index.ts";
  import type { Palette, Skin } from "./skins/types.ts";
  import { remember, render, type Past, type Thumb } from "./render.ts";
  import { readSlot, writeSlot } from "./lib/storage.ts";
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
  // the look: saved on its own, so a skin change never touches the game
  const SKIN = "jailbirds:skin";
  let skin = $state.raw<Skin>(skinById(readSlot(SKIN)));
  function pickSkin(s: Skin) {
    skin = s;
    writeSlot(SKIN, s.id);
    repaint();
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
  let sheet = $state<"" | "about" | "settings" | "ios" | "restart">("");

  let canvasEl = $state<HTMLCanvasElement>();
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
    past = null;
    thumb = null;
    keys.clear();
    save();
    sync();
  }

  // input: a thumb stick wherever the finger goes down, or arrows and wasd
  const STICK = 44;
  let thumb: Thumb = null;
  let pointer: number | null = null;
  const keys = new Set<string>();
  function stick(): Stick {
    if (thumb) {
      const dx = (thumb.x - thumb.ox) / STICK, dy = (thumb.y - thumb.oy) / STICK;
      return { x: dx, y: dy };
    }
    const x = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
    const y = (keys.has("down") ? 1 : 0) - (keys.has("up") ? 1 : 0);
    return { x, y };
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
  }
  function keyup(e: KeyboardEvent) {
    const k = KEYS[e.key];
    if (k) keys.delete(k);
  }
  const blur = () => keys.clear();

  // the canvas fills its space at the screen's real pixel density
  let dpr = 1;
  let cssW = 1;
  let cssH = 1;
  function fit() {
    if (!canvasEl || !surfaceEl) return;
    const box = surfaceEl.getBoundingClientRect();
    dpr = Math.min(3, window.devicePixelRatio || 1);
    cssW = Math.max(1, box.width);
    cssH = Math.max(1, box.height);
    canvasEl.width = Math.round(cssW * dpr);
    canvasEl.height = Math.round(cssH * dpr);
  }

  // real time in, fixed steps out. a hidden page or an open sheet holds the jail still.
  let pal: Palette;
  let past: Past | null = null;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let sinceSave = 0;
  function frame(now: number) {
    const dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
    last = now;
    if (!sheet && !document.hidden) {
      acc += dt;
      while (acc >= DT) {
        past = remember(world);
        step(world, LEVELS, stick());
        acc -= DT;
      }
      sinceSave += dt;
      if (sinceSave > 2) {
        sinceSave = 0;
        save();
      }
      sync();
    }
    const ctx = canvasEl?.getContext("2d");
    if (ctx && pal) render(ctx, world, level(), skin, pal, WORDS, dpr, cssW, cssH, past, sheet ? 1 : acc / DT, now, thumb);
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

  /** a little line-up of a skin's characters for the picker */
  function portrait(el: HTMLCanvasElement, s: Skin) {
    const d = Math.min(3, window.devicePixelRatio || 1);
    el.width = 132 * d;
    el.height = 64 * d;
    const ctx = el.getContext("2d")!;
    ctx.setTransform(d * 1.5, 0, 0, d * 1.5, 0, 0);
    const p = s.palette(dark?.matches ?? false);
    const base = { moving: false, walk: 0, t: 1, carry: 0, mood: "ok" as const, using: null, fighting: false };
    s.character(ctx, { ...base, kind: "player", x: 18, y: 26, face: 1, look: 0, uniform: false }, p);
    s.character(ctx, { ...base, kind: "agent", x: 46, y: 28, face: -1, look: 1, uniform: true }, p);
    s.character(ctx, { ...base, kind: "agent", x: 70, y: 28, face: -1, look: 2, uniform: false }, p);
  }

  let observer: ResizeObserver | undefined;
  let dark: MediaQueryList | undefined;
  const repaint = () => (pal = skin.palette(dark?.matches ?? false));
  onMount(() => {
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
      {#if boosted > 0}<div class="stat boost" id="boost"><span>zoom</span><b>{boosted}s</b></div>{/if}
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
    {#key cheerKey}{#if cheer}<div class="cheer" role="status">{cheer}</div>{/if}{/key}
  </div>
  <footer class="foot">
    <p class="tip" id="tip">{#if !saved}<span class="warn">this browser is not saving your jail</span>{:else}{tip}{/if}</p>
    <nav class="nav" aria-label="jailbirds">
      <button id="about" aria-label="menu and about" onclick={() => (sheet = "about")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" /></svg>menu</button>
      <button id="nav-settings" aria-label="settings" onclick={() => (sheet = "settings")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h16" /><circle cx="9" cy="8" r="2.5" class="knob" /><circle cx="15" cy="16" r="2.5" class="knob" /></svg>settings</button>
      <button id="restart" aria-label="start over" onclick={() => (sheet = "restart")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95" /><path d="M19.5 4v4h-4" /></svg>new jail</button>
    </nav>
  </footer>
</main>

{#if updateReady}<button class="update" onclick={applyUpdate}>new version, tap to load</button>{/if}

{#if sheet}
  <dialog bind:this={dialog} class="sheet" onclose={() => (sheet = "")}>
    <div class="card">
      {#if sheet === "about"}
        <h2 class="title">{@html wordmark}</h2>
        <p>you are the warden. drag anywhere to walk (arrow keys work too). everything else happens when you walk onto it.</p>
        <p>new {skin.noun} come by bus and line up at intake. stand behind the desk to check them in (they get striped shirts), then walk up to them and they follow you. lead them to a cell with a free bed.</p>
        <p>a bubble over someone means they want something: walk to their cell and lead them to the canteen or the showers. tables need trays from the kitchen. toilets in the cells get messy: walk over a mess to clean it. happy {skin.noun} drop coins, and so do the desks.</p>
        <p>when one has served their time a key pops up over them: lead them to the release desk to set them free. each one set free earns a star, and stars fill your level. price tags with a lock open at a higher level.</p>
        <p>now and then two start a squabble: run over to calm them down. and keep an eye out for free skates, they make you zoom.</p>
        <button id="settings" onclick={() => (sheet = "settings")}>looks: {skin.name}</button>
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
      {:else if sheet === "settings"}
        <h2>settings</h2>
        <p class="hint">who lives in your jail? the game stays the same, only the look changes.</p>
        <div class="skins">
          {#each SKINS as s (s.id)}
            <button id={`skin-${s.id}`} class="skin" class:now={s === skin} aria-pressed={s === skin} onclick={() => pickSkin(s)}>
              <canvas use:portrait={s} aria-hidden="true"></canvas>
              <span>{s.name}</span>
            </button>
          {/each}
        </div>
      {:else if sheet === "restart"}
        <h2>start over?</h2>
        <p>your jail, your {skin.noun} and your coins all go away.</p>
        <button id="confirm-restart" class="big" onclick={() => { sheet = ""; restart(); }}>start over</button>
      {:else if sheet === "ios"}
        <h2>install jailbirds</h2>
        <p>in safari, tap the <b>share</b> button, then <b>add to home screen</b>.</p>
      {/if}
      <button id="close" class="big" onclick={() => (sheet = "")}>{sheet === "restart" ? "keep playing" : "back"}</button>
    </div>
  </dialog>
{/if}
