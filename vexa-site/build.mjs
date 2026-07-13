import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(siteDir, "dist");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const filename of ["index.html", "styles.css", "app.js"]) {
  await cp(path.join(siteDir, filename), path.join(outputDir, filename));
}

// Copy the entire assets/ tree recursively — spritesheet, self-hosted webfonts
// (Instrument Serif / Instrument Sans / JetBrains Mono), and the vexa-demo.gif
// used as the social/OG preview image.
await cp(path.join(siteDir, "assets"), path.join(outputDir, "assets"), {
  recursive: true,
});

console.log(`VEX Mission Companion pitch site built at ${outputDir}`);
