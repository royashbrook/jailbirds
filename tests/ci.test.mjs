import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// the checks and the deploy run in the playwright image, which has the browsers in it.
// the image has to be the one for the playwright this repo tests with, or no browser is found
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const want = JSON.parse(read("package.json")).devDependencies["@playwright/test"];

for (const name of ["check", "deploy"]) {
  test(`the ${name} job runs in the image for playwright ${want}, with a time limit and no install`, () => {
    const yml = read(`.github/workflows/${name}.yml`);
    assert.deepEqual(yml.match(/^ +image: .*$/gm), [`      image: mcr.microsoft.com/playwright:v${want}-noble`]);
    assert.match(yml, /^    timeout-minutes: \d+$/m);
    assert.doesNotMatch(yml, /playwright install/);
  });
}
