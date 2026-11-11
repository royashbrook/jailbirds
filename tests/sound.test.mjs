import { test } from "node:test";
import assert from "node:assert/strict";
import { createSound, mixer, strike } from "../src/lib/sound.ts";
import { SCORE, hz } from "../src/content/sound.ts";

// a stand-in for web audio with a clock moved by hand. it keeps what was asked of
// it: every source started, when, how loud, on which bus, and when it was stopped.
function rig(t, { born = "suspended", name = "AudioContext" } = {}) {
  const r = { now: 0, made: 0, resumes: 0, suspends: 0, starts: [], gains: [], held: [], hold: false, refuse: false, ctx: null };
  const timers = new Set();
  const param = (value = 0) => ({
    value,
    events: [],
    setValueAtTime(v, at) { this.events.push(["set", v, at]); },
    linearRampToValueAtTime(v, at) { this.events.push(["line", v, at]); },
    exponentialRampToValueAtTime(v, at) { this.events.push(["curve", v, at]); },
    setTargetAtTime(v, at, k) { this.events.push(["target", v, at, k]); },
    cancelScheduledValues(at) { this.events.push(["cancel", at]); },
  });
  const node = (more) => ({ to: null, connect(out) { this.to = out; }, disconnect() { this.to = null; }, ...more });
  const source = (more) => {
    const s = node({ at: null, stop: null, start(at) { s.at = at; r.starts.push(s); }, ...more });
    s.stop = (at) => { s.stopAt = at; };
    return s;
  };
  const change = (ctx, state) => {
    if (r.refuse && state === "running") return new Promise(() => {});
    const go = () => { ctx.state = state; ctx.onstatechange?.(); };
    if (r.hold) return new Promise((done) => r.held.push(() => { go(); done(); }));
    go();
    return Promise.resolve();
  };
  class Ctx {
    constructor() { r.made++; r.ctx = this; this.state = born; this.sampleRate = 800; this.destination = { name: "out" }; }
    get currentTime() { return r.now; }
    createGain() { const g = node({ gain: param(1) }); r.gains.push(g); return g; }
    createOscillator() { return source({ wave: true, type: "sine", frequency: param(440) }); }
    createBufferSource() { return source({ wave: false, buffer: null, loop: false }); }
    createBiquadFilter() { return node({ type: "", Q: param(1), frequency: param(350) }); }
    createBuffer(_c, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
    createDynamicsCompressor() { return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }); }
    resume() { r.resumes++; return change(this, "running"); }
    suspend() { r.suspends++; return change(this, "suspended"); }
  }
  const real = { A: globalThis.AudioContext, W: globalThis.webkitAudioContext, set: globalThis.setInterval, clear: globalThis.clearInterval };
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
  if (name) globalThis[name] = Ctx;
  globalThis.setInterval = (fn) => {
    const id = { fn };
    timers.add(id);
    return id;
  };
  globalThis.clearInterval = (id) => void timers.delete(id);
  t.after(() => {
    globalThis.AudioContext = real.A;
    globalThis.webkitAudioContext = real.W;
    globalThis.setInterval = real.set;
    globalThis.clearInterval = real.clear;
  });
  r.timers = timers;
  /** let promise callbacks run */
  r.flush = () => new Promise((done) => setImmediate(done));
  /** move the clock, ticking the player's timer as a browser would */
  r.pass = (seconds) => {
    const end = r.now + seconds;
    while (r.now < end - 1e-9) {
      r.now = Math.min(end, r.now + 0.025);
      for (const id of [...timers]) id.fn();
    }
  };
  /** let everything the browser was holding back happen, and whatever that sets off */
  r.release = async () => {
    r.hold = false;
    while (r.held.length) {
      r.held.shift()();
      await r.flush();
    }
  };
  /** every source started so far on a bus, as plain facts */
  r.heard = (bus) => {
    const want = r.gains[bus === "music" ? 1 : 2];
    return r.starts
      .map((s) => {
        const band = s.wave ? null : s.to, gain = s.wave ? s.to : band.to;
        return { at: s.at, f: (s.wave ? s.frequency : band.frequency).events[0][1], level: gain.gain.events[1][1], stop: s.stopAt, out: gain.to, noise: !s.wave };
      })
      .filter((s) => s.out === want);
  };
  /** those that will really sound: not cut off before they begin */
  r.sounding = (bus) => r.heard(bus).filter((s) => s.stop > s.at);
  return r;
}

const BASE = { tap: 1000, slow: 2000, big: 3000 };
/** a score small enough to read: step s of the tune is 100 + s hz, a cue is its base plus its chain */
const TOY = {
  sound: (cue, chain) => Array.from({ length: cue.n }, (_, i) => ({ at: i * 0.01, wave: "sine", from: BASE[cue.kind] + chain, length: cue.fill ?? 0.1, level: 0.2 })),
  rest: { slow: 0.5 },
  steps: 4,
  span: () => 0.25,
  notes: (s) => [{ at: 0, wave: "sine", from: 100 + s, length: 0.2, level: 0.1 }],
};
const tap = { kind: "tap", n: 1 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`);

test("with both switches off no audio is ever made", (t) => {
  const r = rig(t);
  const s = createSound(TOY, { music: false, sfx: false });
  s.wake();
  s.cues([tap]);
  s.quiet(true);
  s.quiet(false);
  s.wake();
  assert.equal(r.made, 0);
  assert.equal(s.report().state, "none");
});

test("nothing is made before the first touch, and coming back into sight is not a touch", (t) => {
  const r = rig(t);
  const s = createSound(TOY, { music: true, sfx: true });
  s.cues([tap]);
  s.pace(1.5);
  s.quiet(true);
  s.quiet(false);
  assert.equal(r.made, 0);
  s.wake();
  assert.equal(r.made, 1);
  assert.equal(r.resumes, 1);
  assert.equal(s.report().state, "running");
  s.wake();
  assert.equal(r.made, 1, "one audio for the life of the page");
  assert.equal(r.resumes, 1, "running audio is not asked again");
});

test("a cue is heard at once, on the cue bus, and no tune plays with music off", (t) => {
  const r = rig(t);
  const s = createSound(TOY, { music: false, sfx: true });
  s.wake();
  r.pass(1);
  s.cues([{ kind: "tap", n: 2 }]);
  assert.deepEqual(r.heard("sfx").map((x) => [x.f, x.level]), [[1000, 0.2], [1000, 0.2]]);
  close(r.heard("sfx")[0].at, 1.01);
  close(r.heard("sfx")[1].at, 1.02);
  assert.equal(r.heard("music").length, 0);
  assert.equal(r.timers.size, 0);
  assert.deepEqual(s.report(), { music: false, sfx: true, state: "running", tune: false, steps: 0, cues: { tap: 1 } });
});

test("the tune is written a little ahead of the clock, in order, and keeps time", (t) => {
  const r = rig(t);
  const s = createSound(TOY, { music: true, sfx: false });
  r.now = 5;
  s.wake();
  assert.ok(r.heard("music").length >= 1, "it starts on the touch, not on the next tick");
  r.pass(10);
  const notes = r.heard("music");
  assert.equal(notes.length, s.report().steps);
  notes.forEach((n, i) => {
    close(n.at, 5.08 + i * 0.25);
    assert.equal(n.f, 100 + (i % 4));
  });
  const last = notes.at(-1).at;
  assert.ok(last >= 15 && last < 15.3 + 1e-9, `the last note written is at ${last}, the clock at 15`);
  s.cues([tap]);
  assert.equal(r.heard("sfx").length, 0, "sounds are off");
  assert.equal(r.timers.size, 1);
  assert.equal(s.report().tune, true);
});

test("the tune goes faster when asked, from the next step on", (t) => {
  const r = rig(t);
  const s = createSound(TOY, { music: true, sfx: false });
  s.wake();
  r.pass(2);
  const before = r.heard("music").length;
  s.pace(2);
  r.pass(2);
  const at = r.heard("music").map((n) => n.at);
  close(at[2] - at[1], 0.25);
  close(at.at(-1) - at.at(-2), 0.125);
  assert.ok(at.length - before >= 15, "about twice as many steps in the same time");
  s.pace(0);
  r.pass(1);
  close(r.heard("music").at(-1).at - r.heard("music").at(-2).at, 0.25);
});

test("music off fades and stops the tune but leaves the audio running, and on again picks up where it stopped", (t) => {
  const r = rig(t);
  const s = createSound(TOY, { music: true, sfx: true });
  s.wake();
  r.pass(0.6);
  const written = s.report().steps;
  const bus = r.gains[1];
  s.setMusic(false);
  assert.equal(r.timers.size, 0);
  assert.equal(s.report().state, "running");
  assert.equal(r.suspends, 0);
  assert.deepEqual(bus.gain.events.at(-1).slice(0, 2), ["target", 0]);
  close(bus.gain.events.at(-1)[2], 0.6);
  const pending = r.heard("music").filter((n) => n.at + 0.2 > 0.6);
  assert.ok(pending.length >= 1);
  for (const n of pending) close(n.stop, 0.7);
  s.cues([tap]);
  assert.equal(r.heard("sfx").length, 1, "sounds still play");
  r.pass(3);
  assert.equal(s.report().steps, written, "nothing is written while it is off");
  s.setMusic(true);
  const next = r.heard("music")[written];
  assert.equal(next.f, 100 + (written % 4));
  close(next.at, 3.6 + 0.08);
  assert.deepEqual(bus.gain.events.at(-1).slice(0, 2), ["target", 0.45]);
  close(bus.gain.events.at(-1)[2], 3.6);
  assert.equal(r.made, 1);
});

test("with the last switch off the audio is put to sleep, and wakes on the same audio", async (t) => {
  const r = rig(t);
  const s = createSound(TOY, { music: true, sfx: false });
  s.wake();
  r.pass(0.6);
  s.setMusic(false);
  await r.flush();
  assert.equal(r.suspends, 1);
  assert.equal(s.report().state, "suspended");
  assert.equal(r.timers.size, 0);
  assert.equal(r.sounding("music").filter((n) => n.at + 0.2 > 0.6).length, 0, "nothing is left to sound on waking");
  s.setSfx(true);
  await r.flush();
  assert.equal(r.made, 1);
  assert.equal(r.resumes, 2);
  assert.equal(s.report().state, "running");
  assert.equal(s.report().tune, false);
});

test("a page out of sight is silent and asleep, and comes back by itself", async (t) => {
  const r = rig(t);
  const s = createSound(TOY, { music: true, sfx: true });
  s.wake();
  r.pass(1);
  r.hold = true;
  s.quiet(true);
  s.cues([tap]);
  assert.equal(r.heard("sfx").length, 0, "no cue from the moment it is hidden, asleep yet or not");
  await r.release();
  assert.equal(s.report().state, "suspended");
  assert.equal(s.report().tune, false);
  assert.equal(r.sounding("music").filter((n) => n.at + 0.2 > 1).length, 0);
  const cuesBefore = r.heard("sfx").length;
  s.cues([tap]);
  s.wake();
  await r.flush();
  assert.equal(r.heard("sfx").length, cuesBefore, "no cue while out of sight");
  assert.equal(s.report().state, "suspended", "a touch does not wake a hidden page");
  const written = s.report().steps;
  s.quiet(false);
  await r.flush();
  assert.equal(r.made, 1);
  assert.equal(s.report().state, "running");
  assert.equal(s.report().tune, true);
  assert.equal(r.heard("music")[written].f, 100 + (written % 4));
});

test("the browser may say no: every touch asks again, and nothing saved up plays when it says yes", async (t) => {
  const r = rig(t);
  r.refuse = true;
  const s = createSound(TOY, { music: true, sfx: true });
  s.wake();
  s.cues([tap]);
  s.wake();
  s.cues([tap]);
  s.wake();
  await r.flush();
  assert.equal(r.made, 1);
  assert.equal(r.resumes, 3);
  assert.equal(r.starts.length, 0);
  assert.equal(s.report().tune, false);
  r.refuse = false;
  s.wake();
  await r.flush();
  assert.equal(s.report().state, "running");
  assert.equal(r.heard("sfx").length, 0, "the cues from before are gone");
  assert.ok(r.heard("music").length >= 1);
});

test("a yes that comes after it is no longer wanted ends asleep and silent", async (t) => {
  const r = rig(t);
  r.hold = true;
  const s = createSound(TOY, { music: true, sfx: false });
  s.wake();
  s.setMusic(false);
  assert.equal(r.resumes, 1);
  await r.release();
  assert.equal(r.suspends, 1);
  assert.equal(s.report().state, "suspended");
  assert.equal(r.starts.length, 0);
  assert.equal(r.timers.size, 0);
});

test("sleep that comes after it is wanted again does not stick", async (t) => {
  const r = rig(t);
  const s = createSound(TOY, { music: true, sfx: false });
  s.wake();
  r.pass(0.5);
  r.hold = true;
  s.setMusic(false);
  s.setMusic(true);
  assert.equal(r.suspends, 1);
  await r.release();
  assert.equal(s.report().state, "running");
  assert.equal(s.report().tune, true);
  assert.equal(r.timers.size, 1, "one timer, however many times it was started");
  const from = r.sounding("music").length;
  r.pass(1);
  assert.ok(r.sounding("music").length - from >= 3, "and it is really playing");
});

test("turning sounds on is heard once, when the audio runs", async (t) => {
  const r = rig(t);
  r.hold = true;
  const s = createSound(TOY, { music: false, sfx: false });
  s.setSfx(true, tap);
  assert.equal(r.made, 1, "the switch is a touch");
  assert.equal(r.starts.length, 0, "not before the audio runs");
  await r.release();
  assert.equal(r.heard("sfx").length, 1);
  s.wake();
  s.setMusic(true);
  await r.flush();
  assert.equal(r.heard("sfx").length, 1, "once");
  s.setSfx(false, tap);
  await r.flush();
  assert.equal(r.heard("sfx").length, 1, "off says nothing");
});

test("sounds turned on and off again before the audio runs say nothing", async (t) => {
  const r = rig(t);
  r.hold = true;
  const s = createSound(TOY, { music: true, sfx: false });
  s.setSfx(true, tap);
  s.setSfx(false);
  await r.release();
  assert.equal(s.report().state, "running");
  assert.equal(r.heard("sfx").length, 0);
});

test("two of a kind too close together are one, and a quick run of them counts up", (t) => {
  const r = rig(t);
  const s = createSound(TOY, { music: false, sfx: true });
  s.wake();
  const at = (now, kind = "tap") => { r.now = now; s.cues([{ kind, n: 1 }]); };
  at(1);
  at(1.02);
  at(1.1);
  at(1.2);
  at(2);
  assert.deepEqual(r.heard("sfx").map((x) => x.f), [1000, 1001, 1002, 1000]);
  at(3, "slow");
  at(3.3, "slow");
  at(3.6, "slow");
  assert.deepEqual(r.heard("sfx").slice(4).map((x) => x.f), [2000, 2001]);
  r.now = 5;
  s.cues([tap, tap, { kind: "slow", n: 1 }]);
  assert.deepEqual(r.heard("sfx").slice(6).map((x) => x.f), [1000, 2000], "kinds do not hold each other back");
  assert.deepEqual(s.report().cues, { tap: 5, slow: 3 });
});

test("only so many cue sounds at once", (t) => {
  const r = rig(t);
  const s = createSound(TOY, { music: true, sfx: true });
  s.wake();
  r.pass(1);
  s.cues([{ kind: "big", n: 40, fill: 1 }]);
  assert.equal(r.heard("sfx").length, 24);
  r.pass(0.5);
  s.cues([{ kind: "tap", n: 3 }]);
  assert.equal(r.heard("sfx").length, 24, "still full");
  r.pass(1);
  s.cues([{ kind: "tap", n: 3 }]);
  assert.equal(r.heard("sfx").length, 27, "room again when they have rung out");
  assert.ok(r.heard("music").length > 8, "the tune is not counted against the cues");
});

test("audio the phone interrupted is asked to run again, and a closed one is left alone", async (t) => {
  const r = rig(t, { born: "interrupted" });
  const s = createSound(TOY, { music: false, sfx: true });
  s.wake();
  await r.flush();
  assert.equal(r.resumes, 1);
  assert.equal(s.report().state, "running");
  r.ctx.state = "closed";
  s.wake();
  assert.equal(r.resumes, 1);
  s.cues([tap]);
  assert.equal(r.starts.length, 0);
});

test("audio that stops by itself stops the tune, and it starts again when the audio does", (t) => {
  const r = rig(t);
  const s = createSound(TOY, { music: true, sfx: false });
  s.wake();
  r.pass(1);
  r.ctx.state = "interrupted";
  r.ctx.onstatechange();
  assert.equal(s.report().tune, false);
  assert.equal(r.sounding("music").filter((n) => n.at + 0.2 > 1).length, 0);
  r.ctx.state = "running";
  r.ctx.onstatechange();
  assert.equal(s.report().tune, true);
});

test("a browser with no audio, or the old name for it, is fine", (t) => {
  const none = rig(t, { name: null });
  const a = createSound(TOY, { music: true, sfx: true });
  a.wake();
  a.cues([tap]);
  a.setMusic(false);
  a.quiet(true);
  assert.equal(none.made, 0);
  assert.equal(a.report().state, "none");
  const old = rig(t, { name: "webkitAudioContext" });
  const b = createSound(TOY, { music: true, sfx: true });
  b.wake();
  assert.equal(old.made, 1);
  assert.equal(b.report().state, "running");
});

test("a blip rises fast, dies away over its length, and is stopped just after", (t) => {
  const r = rig(t);
  const ctx = new globalThis.AudioContext();
  const out = ctx.createGain();
  const s = strike(ctx, out, { at: 0, wave: "triangle", from: 300, to: 600, length: 0.4, level: 0.25 }, 2);
  assert.equal(s.type, "triangle");
  assert.equal(s.at, 2);
  close(s.stopAt, 2.42);
  assert.deepEqual(s.frequency.events, [["set", 300, 2], ["curve", 600, 2.4]]);
  const env = s.to.gain.events;
  assert.deepEqual(env[0], ["set", 0, 2]);
  assert.deepEqual(env[1].slice(0, 2), ["line", 0.25]);
  close(env[1][2], 2.008);
  assert.deepEqual(env[2], ["curve", 0.0001, 2.4]);
  assert.equal(s.to.to, out);
  s.onended();
  assert.equal(s.to.to, null, "and is unplugged when it is over");
  const short = strike(ctx, out, { at: 0, wave: "sine", from: 300, length: 0.02, level: 0.1 }, 0);
  close(short.to.gain.events[1][2], 0.005);
  assert.equal(short.frequency.events.length, 1, "no glide unless asked");
  assert.equal(r.starts.length, 2);
});

test("hiss is the same every time, loops, and goes through a band", (t) => {
  rig(t);
  const ctx = new globalThis.AudioContext();
  const out = ctx.createGain();
  const a = strike(ctx, out, { at: 0, wave: "noise", from: 1500, to: 5000, length: 0.3, level: 0.2 }, 1);
  const b = strike(ctx, out, { at: 0, wave: "noise", from: 6000, length: 0.05, level: 0.1 }, 1);
  assert.equal(a.loop, true);
  assert.equal(a.buffer, b.buffer, "one buffer for the audio's life");
  const data = a.buffer.getChannelData(0);
  assert.equal(data.length, 800);
  assert.ok(data.every((v) => v >= -1 && v < 1));
  assert.ok(Math.abs(data.reduce((sum, v) => sum + v, 0) / data.length) < 0.1, "centred on zero");
  assert.ok(new Set(data).size > 700, "and really noise");
  assert.deepEqual([...data.slice(0, 3)].map((v) => Math.round(v * 1e6)), [696516, 795273, -186477]);
  assert.equal(a.to.type, "bandpass");
  assert.deepEqual(a.to.frequency.events, [["set", 1500, 1], ["curve", 5000, 1.3]]);
  assert.equal(a.to.to.to, out);
});

test("both buses go out through one limiter, the tune quieter than the cues", (t) => {
  rig(t);
  const ctx = new globalThis.AudioContext();
  const { music, sfx, level } = mixer(ctx);
  assert.equal(music.gain.value, level);
  assert.ok(level < sfx.gain.value);
  assert.equal(music.to, sfx.to);
  const limit = music.to.to;
  assert.equal(limit.to, ctx.destination);
  assert.ok(limit.threshold.value < 0 && limit.ratio.value > 1);
  assert.ok(music.to.gain.value <= 1);
});

// the jail's own score

const KINDS = ["coin", "pile", "pay", "buy", "checkin", "follow", "bed", "seat", "carry", "drop", "clean", "release", "rank", "level", "fight", "calm", "boost", "ride"];
const sane = (b, what) => {
  assert.ok(["sine", "triangle", "square", "sawtooth", "noise"].includes(b.wave), `${what}: wave ${b.wave}`);
  for (const f of [b.from, b.to ?? b.from]) assert.ok(Number.isFinite(f) && f >= 55 && f <= 9000, `${what}: ${f} hz`);
  assert.ok(b.at >= 0 && b.at < 2, `${what}: at ${b.at}`);
  assert.ok(b.length >= 0.03 && b.length <= 2, `${what}: length ${b.length}`);
  assert.ok(b.level > 0 && b.level <= 0.3, `${what}: level ${b.level}`);
};

test("note names are the notes", () => {
  assert.equal(hz("A4"), 440);
  close(hz("A5"), 880);
  assert.ok(Math.abs(hz("C4") - 261.6256) < 0.001);
  close(hz("Eb4"), hz("D#4"));
  close(hz("C5", -12), hz("C4"));
  assert.throws(() => hz("H2"));
  assert.throws(() => hz("C"));
});

test("every cue has a sound, short and in range", () => {
  for (const kind of KINDS)
    for (const n of [1, 2, 5, 40])
      for (const chain of [0, 3, 50])
        for (const fill of [0, 0.5, 1]) {
          const blips = SCORE.sound({ kind, n, fill }, chain);
          assert.ok(blips.length >= 1 && blips.length <= 24, `${kind} is ${blips.length} blips`);
          for (const b of blips) sane(b, kind);
          const over = Math.max(...blips.map((b) => b.at + b.length));
          assert.ok(over <= 2.2, `${kind} lasts ${over}s`);
        }
});

test("the small sounds that come in runs are short, and are held apart", () => {
  for (const kind of ["coin", "pay", "carry", "drop"]) {
    const blips = SCORE.sound({ kind, n: 1, fill: 0.5 }, 0);
    assert.ok(Math.max(...blips.map((b) => b.at + b.length)) <= 0.25, kind);
    assert.ok(SCORE.rest[kind] >= 0.04, `${kind} has a rest`);
  }
});

test("a run of coins climbs and stays on top, more coins are more notes, and a price tag rises as it fills", () => {
  const first = (chain) => SCORE.sound({ kind: "coin", n: 1 }, chain)[0].from;
  assert.ok(first(0) < first(1) && first(1) < first(2) && first(2) < first(5));
  assert.equal(first(7), first(50));
  assert.equal(first(7), hz("C7"));
  const starts = (n) => new Set(SCORE.sound({ kind: "coin", n }, 0).map((b) => b.at)).size;
  assert.deepEqual([starts(1), starts(2), starts(3), starts(9)], [1, 2, 3, 3]);
  const tick = (fill) => SCORE.sound({ kind: "pay", n: 1, fill }, 0)[0].from;
  assert.ok(tick(0) < tick(0.5) && tick(0.5) < tick(1));
  close(tick(1), tick(0) * 2);
  const led = (n) => SCORE.sound({ kind: "follow", n }, 0)[0].to;
  assert.ok(led(1) < led(2) && led(2) < led(3));
  const stack = (n) => SCORE.sound({ kind: "carry", n }, 0)[0].from;
  assert.ok(stack(1) < stack(2) && stack(2) < stack(4));
});

test("the tune is thirty-two swung bars that come round in a minute and a quarter", () => {
  assert.equal(SCORE.steps, 256);
  let total = 0;
  for (let i = 0; i < SCORE.steps; i++) total += SCORE.span(i);
  close(total, 76.8);
  assert.ok(SCORE.span(0) > SCORE.span(1), "long then short");
  close(SCORE.span(0) + SCORE.span(1), 0.6);
  for (let i = 0; i < SCORE.steps; i++)
    for (const b of SCORE.notes(i)) {
      sane(b, `step ${i}`);
      assert.equal(b.at, 0);
    }
});

test("every bar has a low note on one, and no step in the busy parts is empty for long", () => {
  for (let bar = 0; bar < 32; bar++) {
    const low = SCORE.notes(bar * 8).filter((b) => b.wave === "triangle" && b.from < 230);
    assert.equal(low.length, 1, `bar ${bar}`);
    assert.ok(low[0].from >= hz("C3") - 1e-9);
  }
  for (let bar = 0; bar < 32; bar++) {
    const root = SCORE.notes(bar * 8).find((b) => b.wave === "triangle").from;
    const fifth = SCORE.notes(bar * 8 + 4).filter((b) => b.wave === "triangle" && b.level >= 0.15);
    assert.equal(fifth.length, 1, `bar ${bar}`);
    assert.ok(fifth[0].from > 120 && fifth[0].from < 221, `bar ${bar}: the bass goes to ${fifth[0].from}`);
    assert.ok([0.75, 1.5].some((r) => Math.abs(fifth[0].from / root - r) < 1e-9));
  }
  const lead = (i) => SCORE.notes(i).filter((b) => b.wave === "sine" && b.level >= 0.15);
  close(lead(0)[0].length, 0.36 + 0.25);
  close(lead(9 * 8)[0].length, 0.36 + 0.24 + 0.36 + 0.25);
  close(lead(24 * 8)[0].length, 1.2 + 0.25);
  for (let bar = 0; bar < 32; bar++) {
    let notes = 0;
    for (let i = 0; i < 8; i++) notes += lead(bar * 8 + i).length;
    assert.ok(notes >= 2 && notes <= 4, `bar ${bar} has ${notes} tune notes`);
  }
});

test("the last part is the quiet one, and the second time round the first part has more on top", () => {
  const count = (from, to, pick) => {
    let n = 0;
    for (let i = from * 8; i < to * 8; i++) n += SCORE.notes(i).filter(pick).length;
    return n;
  };
  const hiss = (b) => b.wave === "noise";
  assert.equal(count(0, 8, hiss), 32);
  assert.equal(count(8, 16, hiss), 32);
  assert.equal(count(24, 32, hiss), 0);
  const all = () => true;
  assert.ok(count(24, 32, all) < count(0, 8, all) * 0.6);
  assert.ok(count(16, 24, all) > count(0, 8, all));
  const tune = (bar) => Array.from({ length: 8 }, (_, i) => SCORE.notes(bar * 8 + i).filter((b) => b.level >= 0.15 && b.wave === "sine").map((b) => Math.round(b.from)));
  assert.deepEqual(tune(16), tune(0), "the same tune again");
  assert.notDeepEqual(tune(8), tune(0));
});

test("the tune sits under the cues: its notes are lower than a coin and no louder", () => {
  const coin = SCORE.sound({ kind: "coin", n: 1 }, 0)[0];
  for (let i = 0; i < SCORE.steps; i++)
    for (const b of SCORE.notes(i)) {
      if (b.level < 0.15) continue;
      assert.ok(b.level <= coin.level);
      if (b.wave === "sine") assert.ok(b.from <= hz("E5") + 1e-9, `step ${i} is ${b.from}`);
    }
});
