import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(siteDir, "dist");

await rm(outputDir, { recursive: true, force: true });
await mkdir(path.join(outputDir, "assets"), { recursive: true });

for (const filename of ["index.html", "styles.css", "app.js"]) {
  await cp(path.join(siteDir, filename), path.join(outputDir, filename));
}

await cp(
  path.join(siteDir, "assets/vexa-spritesheet.webp"),
  path.join(outputDir, "assets/vexa-spritesheet.webp"),
);

console.log(`Vexa pitch site built at ${outputDir}`);
