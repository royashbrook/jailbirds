// a small synth and a tune player over web audio. it knows nothing of any game:
// a score says, as plain lists of blips, what each cue sounds like and what the
// tune plays on each of its steps. nothing is loaded and nothing is recorded,
// every sound is drawn when it is wanted.
//
// the browser decides when a page may make sound. so nothing here latches: every
// touch asks again while the audio is not running, a hidden page is put to sleep,
// and with both switches off no audio is made at all.

/** one short sound: a wave (or a band of hiss round `from`) that fades out over `length` seconds */
export interface Blip { at: number; wave: OscillatorType | "noise"; from: number; to?: number; length: number; level: number }
export interface Cue<K extends string = string> { kind: K; n: number; fill?: number }
export interface Score<K extends string = string> {
  /** a cue as blips. `chain` counts the same kind of cue coming again and again in quick succession */
  sound(cue: Cue<K>, chain: number): Blip[];
  /** the shortest time between two of a kind, in seconds; anything sooner is skipped */
  rest: Partial<Record<K, number>>;
  /** the tune: how many steps before it comes round again, how long each lasts, and what sounds on it */
  steps: number;
  span(step: number): number;
  notes(step: number): Blip[];
}

/** how loud everything is, the tune under the cues, before the limiter */
const MASTER = 0.5;
const MUSIC = 0.45;
/** how far ahead of the clock the tune is written, and how often that is checked */
const AHEAD = 0.3;
const EVERY = 25;
/** cues of a kind this close together are one run; no more than this many cue blips sound at once */
const CHAIN = 0.7;
const REST = 0.04;
const VOICES = 24;

const hiss = new WeakMap<BaseAudioContext, AudioBuffer>();
/** a second of noise, the same on every device */
function noise(ctx: BaseAudioContext) {
  let buffer = hiss.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 22222;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = seed / 2147483648 - 1;
    }
    hiss.set(ctx, buffer);
  }
  return buffer;
}

/** sound one blip at `when` on the context's clock */
export function strike(ctx: BaseAudioContext, out: AudioNode, b: Blip, when: number): AudioScheduledSourceNode {
  const end = when + b.length;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(b.level, when + Math.min(0.008, b.length / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  gain.connect(out);
  let source: AudioScheduledSourceNode;
  if (b.wave === "noise") {
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(b.from, when);
    if (b.to) band.frequency.exponentialRampToValueAtTime(b.to, end);
    const loop = ctx.createBufferSource();
    loop.buffer = noise(ctx);
    loop.loop = true;
    loop.connect(band);
    band.connect(gain);
    source = loop;
  } else {
    const wave = ctx.createOscillator();
    wave.type = b.wave;
    wave.frequency.setValueAtTime(b.from, when);
    if (b.to) wave.frequency.exponentialRampToValueAtTime(b.to, end);
    wave.connect(gain);
    source = wave;
  }
  source.onended = () => gain.disconnect();
  source.start(when);
  source.stop(end + 0.02);
  return source;
}

/** the way out: a bus for the tune and one for the cues, through one limiter so a pile-up cannot clip */
export function mixer(ctx: BaseAudioContext) {
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -18;
  limit.knee.value = 12;
  limit.ratio.value = 8;
  limit.attack.value = 0.003;
  limit.release.value = 0.2;
  limit.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = MASTER;
  master.connect(limit);
  const music = ctx.createGain();
  music.gain.value = MUSIC;
  music.connect(master);
  const sfx = ctx.createGain();
  sfx.connect(master);
  return { music, sfx, level: MUSIC };
}

export function createSound<K extends string>(score: Score<K>, on: { music: boolean; sfx: boolean }) {
  let music = on.music, sfx = on.sfx, hidden = false;
  let ctx: AudioContext | null = null;
  let bus: ReturnType<typeof mixer> | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let step = 0, nextAt = 0, speed = 1, played = 0;
  /** tune blips written but not over yet, so they can be cut short */
  let tune: { source: AudioScheduledSourceNode; end: number }[] = [];
  /** when each sounding cue blip ends */
  let voices: number[] = [];
  let hello: Cue<K> | null = null;
  const last = new Map<K, number>(), chains = new Map<K, number>();
  const heard: Record<string, number> = {};

  const wanted = () => (music || sfx) && !hidden;
  const never = () => {};

  /** the audio is made on the first touch that wants it, never before */
  function ensure() {
    if (ctx || !wanted()) return ctx;
    const scope = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Maker = scope.AudioContext ?? scope.webkitAudioContext;
    if (!Maker) return null;
    try {
      ctx = new Maker();
    } catch {
      return null;
    }
    bus = mixer(ctx);
    ctx.onstatechange = settle;
    return ctx;
  }
  /** ask for the audio to run. a no is not remembered: the next touch asks again */
  function run(c: AudioContext) {
    if (c.state !== "running" && c.state !== "closed") c.resume().then(settle, never);
    else settle();
  }
  /** make what sounds match what is wanted and what the browser allows, whichever changed */
  function settle() {
    const c = ctx;
    if (!c) return;
    if (!wanted()) {
      stopTune(true);
      // by the time it is asleep it may be wanted again
      if (c.state === "running") c.suspend().then(() => (wanted() ? run(c) : settle()), never);
      return;
    }
    if (c.state !== "running") return stopTune(true);
    if (music) startTune();
    else stopTune(false);
    if (hello) play(hello, 0);
    hello = null;
  }

  function startTune() {
    if (timer !== undefined || !ctx || !bus) return;
    const now = ctx.currentTime;
    bus.music.gain.cancelScheduledValues(now);
    bus.music.gain.setTargetAtTime(bus.level, now, 0.04);
    nextAt = now + 0.08;
    timer = setInterval(pump, EVERY);
    pump();
  }
  /** `hard` when the audio is going to sleep: anything left over would sound on waking */
  function stopTune(hard: boolean) {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
    if (!ctx || !bus) return;
    const now = ctx.currentTime;
    if (!hard) {
      bus.music.gain.cancelScheduledValues(now);
      bus.music.gain.setTargetAtTime(0, now, 0.02);
    }
    for (const t of tune)
      try {
        t.source.stop(hard ? 0 : now + 0.1);
      } catch {
        // already over
      }
    tune = [];
  }
  /** write the tune a little way ahead of the clock. it picks up where it stopped */
  function pump() {
    if (!ctx || !bus || ctx.state !== "running") return;
    const now = ctx.currentTime;
    tune = tune.filter((t) => t.end > now);
    if (nextAt < now) nextAt = now + 0.06;
    while (nextAt < now + AHEAD) {
      for (const b of score.notes(step)) tune.push({ source: strike(ctx, bus.music, b, nextAt + b.at / speed), end: nextAt + b.at / speed + b.length });
      nextAt += score.span(step) / speed;
      step = (step + 1) % score.steps;
      played++;
    }
  }

  function play(cue: Cue<K>, chain: number) {
    if (!ctx || !bus) return;
    const now = ctx.currentTime;
    voices = voices.filter((end) => end > now);
    for (const b of score.sound(cue, chain)) {
      if (voices.length >= VOICES) break;
      strike(ctx, bus.sfx, b, now + 0.01 + b.at);
      voices.push(now + 0.01 + b.at + b.length);
    }
    heard[cue.kind] = (heard[cue.kind] ?? 0) + 1;
  }

  /** wanted or not, as of now: asked to run, or put to sleep */
  function turn() {
    if (!ctx) return;
    if (wanted()) run(ctx);
    else settle();
  }
  /** a touch: the only moment a browser lets sound start */
  function wake() {
    ensure();
    turn();
  }

  return {
    /** call on every touch, click and key */
    wake,
    /** what just happened, to be heard now. dropped while the audio is not running: a late sound is a wrong one */
    cues(list: readonly Cue<K>[]) {
      if (!sfx || hidden || !ctx || ctx.state !== "running") return;
      const now = ctx.currentTime;
      for (const cue of list) {
        const was = last.get(cue.kind);
        if (was !== undefined && now - was < (score.rest[cue.kind] ?? REST)) continue;
        const chain = was !== undefined && now - was < CHAIN ? (chains.get(cue.kind) ?? 0) + 1 : 0;
        last.set(cue.kind, now);
        chains.set(cue.kind, chain);
        play(cue, chain);
      }
    },
    /** how fast the tune goes from here on, 1 as written */
    pace(mult: number) {
      speed = mult > 0 ? mult : 1;
    },
    /** the switches. turning one is a touch, so the audio may start here */
    setMusic(v: boolean) {
      music = v;
      wake();
    },
    /** `say` is sounded once the audio runs, so turning sounds on is heard */
    setSfx(v: boolean, say?: Cue<K>) {
      sfx = v;
      hello = v && say ? say : null;
      wake();
    },
    /** the page went out of sight (true) or came back (false). coming back makes no new audio */
    quiet(v: boolean) {
      hidden = v;
      turn();
    },
    report: () => ({ music, sfx, state: ctx ? ctx.state : "none", tune: timer !== undefined, steps: played, cues: { ...heard } }),
  };
}
