import { appendFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as wait } from "node:timers/promises";

// The about sheet links these; a release whose notices are missing is not live.
export const NOTICES = ["/licenses.md"];

// One look at the origin. Returns every way it differs from the expected release.
export async function inspectLive(origin, expected, fetchImpl = fetch) {
  const problems = [];
  const get = (path) =>
    fetchImpl(new URL(path, origin).href, {
      headers: { "cache-control": "no-cache" },
      signal: AbortSignal.timeout(20000),
    });
  try {
    const response = await get("/version.json");
    if (!response.ok) problems.push(`/version.json: HTTP ${response.status}`);
    else {
      const served = JSON.parse(await response.text());
      for (const field of ["source", "build", "version"])
        if (served[field] !== expected[field])
          problems.push(
            `/version.json ${field}: served ${served[field]}, expected ${expected[field]}`,
          );
    }
  } catch (error) {
    problems.push(`/version.json: ${error.message}`);
  }
  const marker = `<meta name="build" content="${expected.build}"`;
  const shell = await text(get, "/", problems);
  if (shell !== null && !shell.includes(marker))
    problems.push(`/: shell does not carry build ${expected.build}`);
  const worker = await text(get, "/sw.js", problems);
  if (worker !== null && !worker.includes(`jailbirds-${expected.build}`))
    problems.push(`/sw.js: worker does not carry build ${expected.build}`);
  for (const path of NOTICES)
    try {
      const response = await get(path);
      if (!response.ok) problems.push(`${path}: HTTP ${response.status}`);
    } catch (error) {
      problems.push(`${path}: ${error.message}`);
    }
  return problems;
}
async function text(get, path, problems) {
  try {
    const response = await get(path);
    if (response.ok) return await response.text();
    problems.push(`${path}: HTTP ${response.status}`);
  } catch (error) {
    problems.push(`${path}: ${error.message}`);
  }
  return null;
}

// Propagation is not instant, so look a bounded number of times, then fail loudly.
export async function verifyLive(
  origin,
  expected,
  { fetchImpl = fetch, tries = 10, delay = 15000, sleep = wait, log } = {},
) {
  let problems = [];
  for (let attempt = 1; attempt <= tries; attempt++) {
    if (attempt > 1) await sleep(delay);
    problems = await inspectLive(origin, expected, fetchImpl);
    if (!problems.length) return { origin, ...expected, attempts: attempt };
    log?.(`attempt ${attempt} of ${tries}: ${problems.join("; ")}`);
  }
  throw Error(
    `Live release at ${origin} does not match the validated build after ${tries} tries:\n` +
      problems.map((p) => `  ${p}`).join("\n"),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [origin, source] = process.argv.slice(2);
  if (!origin || !/^[a-f0-9]{40}$/.test(source || ""))
    throw Error("Usage: node scripts/verify-live.mjs <origin> <source sha>");
  const built = JSON.parse(await readFile("dist/version.json", "utf8"));
  if (built.source !== source)
    throw Error(
      `dist/version.json was built from ${built.source}, not the validated ${source}`,
    );
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (head !== source)
    throw Error(`HEAD is ${head}, not the validated ${source}`);
  const receipt = await verifyLive(origin, built, { log: console.log });
  const line = `Live receipt: ${origin} serves ${receipt.version} build ${receipt.build} source ${receipt.source} (attempt ${receipt.attempts})`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}
