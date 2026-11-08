// the palettes. birds and pegs share structure and differ in mood: birds are a
// warm sunny jail, pegs a cool toy-box one. the characters keep their colours in
// both light and dark, like toys do; the floors and walls dim for the night.
import type { Palette } from "./types.ts";

const birdsLight: Palette = {
  hall: "#f3ead8", hallLine: "#e7dbc2",
  floors: { block: "#ece4dc", cell: "#ece4f2", canteen: "#fbe3c4", kitchen: "#e3edf2", washroom: "#dff0f7", intake: "#efe6d0", bed: "#9fc3e8" },
  locked: "#d9d2c6", wall: "#8a7f8f", bars: "#6c6475", wood: "#d4a373", metal: "#c9d3dc", porcelain: "#ffffff",
  road: "#b9bcc4", roadLine: "#f6f6f6", spot: "rgba(92, 159, 214, 0.25)", pad: "#2f8f52", padFill: "rgba(255, 255, 255, 0.82)",
  ink: "#3d3230", inkDim: "#8d8496", label: "#8d7f6e", stick: "rgba(255, 255, 255, 0.5)",
  looks: ["#ffd27a", "#9fd3f5", "#f7a8c4", "#a8e6b8", "#c9b8ff", "#ffb38a"],
};
const birdsDark: Palette = {
  ...birdsLight,
  hall: "#2b2833", hallLine: "#34313d",
  floors: { block: "#33303c", cell: "#3a3546", canteen: "#3f3630", kitchen: "#2f3740", washroom: "#2c3a44", intake: "#37332b", bed: "#5d7fa6" },
  locked: "#211f27", wall: "#a59bb0", bars: "#b3aabc", wood: "#a5835f", metal: "#7d8894",
  road: "#3f424a", roadLine: "#8b8e96", spot: "rgba(140, 194, 238, 0.22)", pad: "#6fd08f", padFill: "rgba(20, 18, 26, 0.75)",
  ink: "#f3eee6", inkDim: "#9b94a6", label: "#a99d8c", stick: "rgba(255, 255, 255, 0.18)",
};
const pegsLight: Palette = {
  ...birdsLight,
  hall: "#e9eee6", hallLine: "#dbe3d6",
  floors: { block: "#e2e6ee", cell: "#dfe7f5", canteen: "#f5e6cf", kitchen: "#e6eef0", washroom: "#d9eef2", intake: "#ece8dc", bed: "#f2a7a0" },
  locked: "#d3d6d0", wall: "#6f7c8a", bars: "#4f5b68", wood: "#e0b47c",
  label: "#7b8574",
  looks: ["#f28b82", "#7fb7e8", "#9bd49b", "#f7c873", "#b79be6", "#f5a6c8"],
};
const pegsDark: Palette = {
  ...birdsDark,
  hall: "#232a2b", hallLine: "#2c3435",
  floors: { block: "#2b313b", cell: "#2f3747", canteen: "#3b342a", kitchen: "#2b3438", washroom: "#24353b", intake: "#33312a", bed: "#8b5e5a" },
  locked: "#1b2021", wall: "#8b98a6", bars: "#a6b1bd", wood: "#a88660",
  label: "#8f9a88",
  looks: pegsLight.looks,
};
export const BIRDS = { light: birdsLight, dark: birdsDark };
export const PEGS = { light: pegsLight, dark: pegsDark };
