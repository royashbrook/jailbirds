import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// preview serves the same site-wide headers the host does (public/_headers, the "/*" block), so every
// local and hosted browser run is held to the live content security policy, not a laxer one
function siteHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  let inBlock = false;
  for (const line of readFileSync(new URL("./public/_headers", import.meta.url), "utf8").split("\n")) {
    if (!/^\s/.test(line)) { inBlock = line.trim() === "/*"; continue; }
    const at = line.indexOf(":");
    if (inBlock && at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  if (!out["Content-Security-Policy"]) throw new Error("public/_headers: no site-wide Content-Security-Policy");
  return out;
}

export default defineConfig({
  plugins: [
    svelte(),
    {
      name: "build-marker",
      transformIndexHtml: (html) =>
        html.replaceAll(
          "%JAILBIRDS_BUILD%",
          process.env.JAILBIRDS_BUILD || "development",
        ),
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(
      process.env.JAILBIRDS_VERSION || "development",
    ),
    __BUILD_ID__: JSON.stringify(process.env.JAILBIRDS_BUILD || "development"),
    __SOURCE_SHA__: JSON.stringify(
      process.env.JAILBIRDS_SOURCE || "development",
    ),
  },
  server: { host: "127.0.0.1", port: 4393, strictPort: true },
  preview: {
    host: "127.0.0.1",
    port: Number(process.env.PORT || 4393),
    strictPort: true,
    headers: siteHeaders(),
  },
  build: {
    target: "es2022",
    license: { fileName: "licenses.md" },
    rolldownOptions: {
      preserveEntrySignatures: "strict",
      input: { app: "index.html", sw: "src/sw.ts" },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "sw"
            ? "[name].js"
            : "assets/[name]-[hash].js",
        postBanner: "/* Bundled dependency licenses: /licenses.md */",
      },
    },
  },
});
