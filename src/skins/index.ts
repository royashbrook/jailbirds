import { birds } from "./birds.ts";
import { pegs } from "./pegs.ts";
import type { Skin } from "./types.ts";

export const SKINS: Skin[] = [birds, pegs];
export const skinById = (id: string | null) => SKINS.find((s) => s.id === id) ?? birds;
