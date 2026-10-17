// Copy the shared 3D assets into an app's public folder: node copy-assets.mjs <app>/public
// The copies are gitignored; packages/body3d/assets is the single source.
import { cpSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
if (!target) throw new Error("usage: copy-assets.mjs <public dir>");
const source = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const dest = join(resolve(target), "body3d");
rmSync(dest, { recursive: true, force: true });
cpSync(source, dest, { recursive: true, filter: (path) => !path.endsWith(".md") });
