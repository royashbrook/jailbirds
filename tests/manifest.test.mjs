import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ipad is the main target, both ways up, so the installed app must not lock to portrait
test("the installed app turns with the ipad", () => {
  const m = JSON.parse(readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"));
  assert.equal(m.orientation, "any");
});
