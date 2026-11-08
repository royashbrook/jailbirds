import { execFileSync } from "node:child_process";
export function releaseIdentity(cwd = process.cwd(), release = false) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const source = git("rev-parse", "HEAD");
  const dirty = !!git("status", "--porcelain");
  const shallow = git("rev-parse", "--is-shallow-repository") === "true";
  const tags = git("tag", "--list")
    .split("\n")
    .filter((tag) => /^v(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag));
  let anchor;
  if (tags.length) {
    try {
      anchor = git(
        "describe",
        "--tags",
        "--first-parent",
        "--abbrev=0",
        ...tags.flatMap((tag) => ["--match", tag]),
      );
    } catch {
      /* No milestone on this history. */
    }
  }
  if (release && (dirty || shallow || !anchor))
    throw Error(
      "Release requires a clean tree, complete history and a vMAJOR.MINOR milestone.",
    );
  const version = anchor
    ? `${anchor.slice(1)}.${git("rev-list", `${anchor}..HEAD`, "--count")}`
    : "0.1.0";
  return {
    version: release ? version : `${version}-dev`,
    source,
    dirty,
    anchor: anchor || null,
  };
}
