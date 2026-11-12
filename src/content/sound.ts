// the jail's sounds and its tune, as data for the player in lib/sound.ts.
// everything is in c major so a coin, a bell and the tune never clash, and the
// cues sit an octave above the tune so they are heard over it.
import type { CueKind } from "../engine/cues.ts";
import type { Blip, Score } from "../lib/sound.ts";

const SEMIS: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
/** "C5", "Eb4", "F#3" as hz, with A4 at 440 */
export function hz(name: string, shift = 0): number {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) throw new Error(`not a note: ${name}`);
  const semis = SEMIS[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) - 4) * 12 + shift;
  return 440 * 2 ** (semis / 12);
}

const blip = (at: number, wave: Blip["wave"], from: number, length: number, level: number, to?: number): Blip =>
  to === undefined ? { at, wave, from, length, level } : { at, wave, from, to, length, level };
/** a small bell: a sine with a quick bright edge an octave up */
const bell = (at: number, f: number, length: number, level: number): Blip[] => [
  blip(at, "sine", f, length, level),
  blip(at, "triangle", f * 2, Math.min(0.08, length / 2), level * 0.3),
];
/** notes one after another, `gap` apart */
const run = (names: string[], gap: number, length: number, level: number, at = 0): Blip[] =>
  names.flatMap((n, i) => bell(at + i * gap, hz(n), length, level));

/** the ladder a run of coins climbs, and stays on top of */
const LADDER = ["G5", "A5", "C6", "D6", "E6", "G6", "A6", "C7"].map((n) => hz(n));
const rung = (i: number) => LADDER[Math.max(0, Math.min(LADDER.length - 1, i))];
/** one step up for each one in the line or on the stack */
const COUNT = ["C5", "D5", "E5", "G5", "A5", "C6", "D6", "E6"].map((n) => hz(n));
const counted = (n: number) => COUNT[Math.max(0, Math.min(COUNT.length - 1, n - 1))];

const SOUNDS: Record<CueKind, (n: number, chain: number, fill: number) => Blip[]> = {
  // money
  coin: (n, chain) => Array.from({ length: Math.min(n, 3) }, (_, i) => bell(i * 0.05, rung(chain + i), 0.14, 0.2)).flat(),
  pile: (n) => Array.from({ length: Math.min(6, 3 + Math.floor(n / 6)) }, (_, i) => bell(i * 0.045, rung(i + 1), 0.13, 0.18)).flat(),
  pay: (_n, _chain, fill) => [blip(0, "triangle", 400 * 2 ** fill, 0.05, 0.12)],
  buy: () => [blip(0, "sine", 150, 0.2, 0.3, 60), ...run(["C5", "E5", "G5", "C6"], 0.07, 0.22, 0.17)],
  // people
  checkin: (_n, chain) => [blip(0, "sine", 520, 0.06, 0.2, 260), ...bell(0.05, rung(2 + chain), 0.26, 0.15)],
  follow: (n) => [blip(0, "sine", counted(n) * 0.7, 0.1, 0.18, counted(n))],
  bed: () => run(["G5", "E5"], 0.09, 0.18, 0.13),
  seat: () => [blip(0, "triangle", 330, 0.07, 0.15, 220), blip(0.02, "sine", hz("C5"), 0.1, 0.1)],
  // chores
  carry: (n) => [blip(0, "triangle", counted(n + 2), 0.06, 0.13), blip(0, "sine", counted(n + 2) * 2, 0.05, 0.05)],
  drop: () => [blip(0, "sine", 260, 0.09, 0.2, 170)],
  clean: () => [blip(0, "noise", 1500, 0.24, 0.2, 5200), ...run(["C7", "E7"], 0.07, 0.14, 0.09, 0.12)],
  // the big moments
  release: () => run(["C6", "G6"], 0.12, 0.5, 0.17),
  rank: () => [...run(["G5", "C6", "E6", "G6"], 0.09, 0.22, 0.16), ...run(["C5", "E5", "G5", "C6"], 0, 0.8, 0.09, 0.4)],
  level: () => [...run(["C5", "E5", "G5", "C6", "E6", "G6", "C7"], 0.08, 0.24, 0.15), ...run(["C5", "G5", "C6", "E6"], 0, 1.3, 0.09, 0.62)],
  fight: () => [0, 0.5].flatMap((at) => [blip(at, "triangle", hz("G4"), 0.15, 0.22), blip(at + 0.16, "triangle", hz("Eb4"), 0.24, 0.22)]),
  calm: () => run(["E5", "G5", "C6"], 0.1, 0.24, 0.15),
  boost: () => [blip(0, "sine", 300, 0.3, 0.15, 1200), ...run(["C6", "E6", "G6"], 0.05, 0.16, 0.13, 0.22)],
  ride: () => [0, 0.2].flatMap((at) => [blip(at, "triangle", hz("A4"), 0.13, 0.08), blip(at, "triangle", hz("D4"), 0.13, 0.06)]),
};

// the tune: 100 beats a minute with a swing, eight steps to a bar, thirty-two
// bars in four parts (a b a c), about a minute and a quarter before it comes
// round. the last part is the quiet one, so the loop has somewhere to breathe.
const BEAT = 0.6;
const SWING = 0.6;
const BAR = 8;
const span = (step: number) => (step % 2 ? 1 - SWING : SWING) * BEAT;

const CHORDS = {
  C: { root: "C3", comp: ["E4", "G4"] },
  Am: { root: "A3", comp: ["E4", "A4"] },
  F: { root: "F3", comp: ["F4", "A4"] },
  G: { root: "G3", comp: ["D4", "G4"] },
  Dm: { root: "D3", comp: ["D4", "F4"] },
  Em: { root: "E3", comp: ["G4", "B4"] },
} as const;
type Chord = keyof typeof CHORDS;

/** a bar's chord and its tune: a note name starts a note, `-` holds it, `.` is a rest */
type Bar = [Chord, string];
const A: Bar[] = [
  ["C", "E5 . G5 . C6 . . ."],
  ["Am", "A5 . . E5 . . . ."],
  ["F", "F5 . A5 . C6 . . ."],
  ["G", "B5 . . G5 . . D5 ."],
  ["C", "E5 . G5 . C6 . E6 ."],
  ["Am", "C6 . . A5 . . . ."],
  ["F", "A5 . F5 . A5 . C6 ."],
  ["G", "D6 . . B5 . G5 . ."],
];
const B: Bar[] = [
  ["F", ". . A5 . C6 . A5 ."],
  ["C", "G5 - - . E5 . . ."],
  ["F", ". . A5 . C6 . D6 ."],
  ["C", "E6 - - . C6 . . ."],
  ["Dm", ". . F5 . A5 . D6 ."],
  ["Am", "C6 - - . A5 . . ."],
  ["F", ". . A5 . C6 . A5 ."],
  ["G", "G5 . B5 . D6 - . ."],
];
const C: Bar[] = [
  ["Am", "A5 - - - E5 - . ."],
  ["Em", "G5 - - - E5 - . ."],
  ["F", "A5 - - - F5 - . ."],
  ["C", "G5 - E5 - C5 - . ."],
  ["Am", "A5 - - - C6 - . ."],
  ["Em", "B5 - - - G5 - . ."],
  ["F", "A5 - C6 - A5 - F5 -"],
  ["G", "G5 - - - D5 . . ."],
];
/** which part each run of eight bars is: "a" again the second time, with a little more on top */
const FORM: { bars: Bar[]; part: "a" | "again" | "b" | "c" }[] = [
  { bars: A, part: "a" }, { bars: B, part: "b" }, { bars: A, part: "again" }, { bars: C, part: "c" },
];
/** the bass goes up to its fifth while that keeps it under the chords, and down to it otherwise */
const BASS_TOP = 221;
/** the tune is written high and played an octave down, under the cues */
const LEAD_SHIFT = -12;

function compose(): Blip[][] {
  const steps: Blip[][] = [];
  for (const { bars, part } of FORM)
    for (const [name, line] of bars) {
      const at = steps.length, chord = CHORDS[name], calm = part === "c";
      const marks = line.split(" ");
      if (marks.length !== BAR) throw new Error(`a bar of ${marks.length} steps: ${line}`);
      for (let i = 0; i < BAR; i++) steps.push([]);
      // the tune, like a small marimba: each note rings for its step and any it is held over
      marks.forEach((mark, i) => {
        if (mark === "." || mark === "-") return;
        let length = span(at + i);
        for (let j = i + 1; j < BAR && marks[j] === "-"; j++) length += span(at + j);
        const f = hz(mark, LEAD_SHIFT);
        steps[at + i].push(blip(0, "sine", f, length + 0.25, 0.16), blip(0, "sine", f * 4, 0.06, 0.025));
        if (part === "again") steps[at + i].push(blip(0, "sine", f * 2, length + 0.1, 0.04));
      });
      // the bass: the root on one, its fifth on three, with an octave on top that small speakers can carry
      const root = hz(chord.root), fifth = root * (root * 1.5 > BASS_TOP ? 0.75 : 1.5);
      const low = (i: number, f: number, length: number) => steps[at + i].push(blip(0, "triangle", f, length, 0.2), blip(0, "sine", f * 2, length * 0.8, 0.06));
      low(0, root, calm ? 1.1 : 0.5);
      low(4, fifth, calm ? 0.9 : 0.45);
      if (!calm) low(6, root, 0.25);
      // the chord, plucked on two and four
      for (const i of calm ? [2] : [2, 6]) for (const n of chord.comp) steps[at + i].push(blip(0, "triangle", hz(n), calm ? 0.5 : 0.14, 0.05));
      // a shaker on the off steps and a tock on two and four, resting in the quiet part
      if (!calm) {
        for (let i = 1; i < BAR; i += 2) steps[at + i].push(blip(0, "noise", 6500, 0.04, 0.03));
        for (const i of [2, 6]) steps[at + i].push(blip(0, "sine", 900, 0.05, 0.04, 600));
      }
    }
  return steps;
}
const TUNE = compose();

/** the squabble's sour note, the low one of the fight cry, out of key on purpose */
const SOUR = hz("Eb4");
/** what the tune takes on while there is trouble: the bar's root pulsed on every step, a thump
 * on one and five, and the sour note on four and eight. all short, so it drives and stays under */
function composeAlarm(): Blip[][] {
  const steps: Blip[][] = [];
  for (const { bars } of FORM)
    for (const [name] of bars) {
      const root = hz(CHORDS[name].root);
      for (let i = 0; i < BAR; i++) {
        const here = [blip(0, "triangle", root, 0.1, 0.12)];
        if (i % 4 === 0) here.push(blip(0, "sine", 160, 0.18, 0.2, 70));
        if (i % 4 === 3) here.push(blip(0, "triangle", SOUR, 0.12, 0.05));
        steps.push(here);
      }
    }
  return steps;
}
const ALARM = composeAlarm();

export const SCORE: Score<CueKind> = {
  sound: (cue, chain) => SOUNDS[cue.kind](cue.n, chain, cue.fill ?? 0),
  rest: { coin: 0.05, pay: 0.06, carry: 0.05, drop: 0.05, checkin: 0.1, clean: 0.2, ride: 2 },
  steps: TUNE.length,
  span,
  notes: (step) => TUNE[step],
  alarm: (step) => ALARM[step],
};
