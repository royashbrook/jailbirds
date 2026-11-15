import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures.js";

// the server a run plays against (scripts/serve.mjs locally and on ci, the host live) sends the
// site-wide headers from public/_headers, so every browser run is held to the live content security policy
const site = {};
let inBlock = false;
for (const line of readFileSync(new URL("../public/_headers", import.meta.url), "utf8").split("\n")) {
  if (!/^\s/.test(line)) { inBlock = line.trim() === "/*"; continue; }
  const at = line.indexOf(":");
  if (inBlock && at > 0) site[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
}

test("the page is served with the site-wide headers, the content security policy among them", async ({ request }) => {
  expect(site["content-security-policy"]).toContain("style-src 'self'");
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  const got = res.headers();
  for (const [name, value] of Object.entries(site)) expect(got[name], name).toBe(value);
});
