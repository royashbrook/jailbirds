import { test } from "node:test";
import assert from "node:assert/strict";
import { remember, forget } from "../src/view/view.ts";

// the view keeps a little per character between frames; a long session must not
// keep it for everyone who ever came and went
test("the view forgets characters who are no longer in the world", () => {
  const w = (ids) => ({ agents: ids.map((id) => ({ id, x: id, y: id, walk: 0 })) });
  const past = new Map();
  remember(w([1, 2, 3, 4]), past);
  assert.deepEqual([...past.keys()], [1, 2, 3, 4]);
  remember(w([1, 3, 9]), past);
  assert.deepEqual([...past.keys()].sort(), [1, 3, 9]);
  const headings = new Map([[1, 0], [5, 1], [6, 2]]);
  forget(w([1]), headings);
  assert.deepEqual([...headings.keys()], [1]);
});
