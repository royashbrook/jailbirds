// one skin for now; the list stays so another can be added without touching the view
import { pegs } from "./pegs.ts";
import type { Skin } from "./types.ts";

export const SKINS: Skin[] = [pegs];
export const skinById = (id: string | null) => SKINS.find((s) => s.id === id) ?? pegs;
