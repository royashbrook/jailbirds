// the logo: you and everyone you have hired, drawn by hand as svg so there is no font or image to
// load. in the game it grows with each new kind of hire. the home screen icon cannot change per save,
// so it shows the whole crew
import { nurseAt } from "../engine/sim.ts";
import type { AgentKind, LevelDef, World } from "../engine/types.ts";
import { DRESS, HEART } from "../skins/pegs.ts";

export type CrewKind = Exclude<AgentKind, "agent"> | "nurse";
/** everyone there can be, the warden first */
export const CREW: CrewKind[] = ["player", "carrier", "escort", "clerk", "cleaner", "collector", "calmer", "nurse"];

/** who is on the crew in this jail right now: one of each kind, however many guards there are */
export function crewOf(w: World, l: LevelDef): CrewKind[] {
  const hired = new Set<string>(w.agents.map((a) => a.kind));
  if (nurseAt(w, l)) hired.add("nurse");
  return CREW.filter((k) => k === "player" || hired.has(k));
}

const INK = "#3a2e2b";
const FACE = "#f1d3a8";
const GOLD = "#ffd23f";
const css = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const line = `stroke="${INK}" stroke-width="1.84"`;
const round = `${line} stroke-linejoin="round"`;
const dome = (d: string, fill: string) => `<path d="${d}" fill="${fill}" ${round}/>`;
const bar = (x: number, y: number, w: number, h: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" ${line}/>`;
const CAP = "M14.18 11.63 a7.82 7.13 0 0 1 15.64 0z";

/** each hat, on a head at (22, 13.35) */
function hat(kind: CrewKind, c: string) {
  switch (kind) {
    case "player":
    case "escort":
      return bar(19.7, 10.36, 10.6, 2.76, c) + dome(CAP, c) + `<circle cx="22" cy="8.06" r="1.49" fill="${GOLD}"/>`;
    case "carrier":
      return `<rect x="16.6" y="4.6" width="10.8" height="5" fill="${c}" ${line}/>` +
        dome("M15.4 5.6 a3.4 3.4 0 0 1 3.6 -3.6 a3.8 3.8 0 0 1 6 0 a3.4 3.4 0 0 1 3.6 3.6z", c);
    case "clerk":
      return bar(14.7, 8.6, 14.6, 2.7, c) + bar(21, 10, 9.4, 2.2, c);
    case "cleaner":
      return dome("M14.6 10.6 a7.4 6.4 0 0 1 14.8 0z", c);
    case "collector":
      return bar(13.7, 10.36, 10.6, 2.76, c) + dome(CAP, c);
    case "calmer":
      return dome("M13.6 12.6 a8.4 8.6 0 0 1 16.8 0z", c) + bar(12.4, 11.6, 19.2, 2, c);
    case "nurse":
      return dome("M15.2 9.8 a6.8 5.2 0 0 1 13.6 0z", c) +
        `<path d="M22 9.2c-2.4-1.6-3-2.8-3-3.7a1.6 1.6 0 0 1 3-.7 1.6 1.6 0 0 1 3 .7c0 .9-.6 2.1-3 3.7z" fill="${css(HEART)}"/>`;
  }
}

/** one person, 44 wide and 52 tall, standing at (22, 50) */
function person(kind: CrewKind) {
  const d = DRESS[kind], body = css(d.body), pants = css(d.pants);
  const limb = (x: number, y: number, w: number, h: number, fill: string, turn = "") =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2}" fill="${fill}" ${line}${turn}/>`;
  return `<ellipse cx="22" cy="49.69" rx="9.2" ry="2.3" fill="#000" opacity=".12"/>` +
    limb(15.68, 39.8, 5.29, 9.66, pants) + limb(23.04, 39.8, 5.29, 9.66, pants) +
    limb(9.7, 23.7, 4.83, 11.5, body, ` transform="rotate(12 12.11 24.85)"`) +
    limb(29.48, 23.7, 4.83, 11.5, body, ` transform="rotate(-12 31.89 24.85)"`) +
    `<rect x="13.95" y="20.25" width="16.1" height="21.85" rx="8.05" fill="${body}" ${line}/>` +
    `<ellipse cx="18.55" cy="27.15" rx="1.84" ry="3.68" fill="#fff" opacity=".35"/>` +
    `<circle cx="22" cy="13.35" r="7.36" fill="${FACE}" ${line}/>` + hat(kind, css(d.hat));
}

/** how far along each next person stands, and how wide the word is */
const STEP = 20, WORD = 152;
/** the logo for this crew: the people in a row, the warden in front, then the word */
export function crewMark(kinds: CrewKind[]) {
  const x = 46 + (kinds.length - 1) * STEP, w = x + WORD;
  const font = `font-family="ui-rounded, &quot;SF Pro Rounded&quot;, system-ui, sans-serif" font-size="30" font-weight="800"`;
  const people = kinds.map((k, i) => `<g data-crew="${k}" transform="translate(${i * STEP} 0)">${person(k)}</g>`).reverse().join("");
  return `<svg class="wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 -2 ${w} 54" role="img" aria-label="jailbirds"><title>jailbirds</title>${people}` +
    `<text x="${x}" y="37" ${font} fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round" opacity=".9">jailbirds</text>` +
    `<text x="${x}" y="37" ${font} fill="${INK}">jailbirds</text></svg>`;
}

/** the home screen icon: the whole crew in two rows behind the bars, the warden front and centre */
export function crewIcon() {
  const row = (kinds: CrewKind[], at: number[], base: number, s: number) =>
    kinds.map((k, i) => `<g data-crew="${k}" transform="translate(${at[i] - 22 * s} ${base - 50 * s}) scale(${s})">${person(k)}</g>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="jailbirds icon"><rect width="512" height="512" rx="112" fill="#ffe9b8"/>` +
    `<g stroke="#9aa6cf" stroke-width="18" stroke-linecap="round"><path d="M96 50V462M176 50V462M336 50V462M416 50V462"/></g>` +
    row(["carrier", "escort", "clerk"], [132, 256, 380], 268, 4) +
    row(["cleaner", "collector", "nurse", "calmer", "player"], [72, 164, 348, 440, 256], 470, 4.3) +
    `</svg>\n`;
}
