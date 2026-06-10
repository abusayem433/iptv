/**
 * Rasterize public/tv-logo-placeholder.svg into PWA / Apple touch icons.
 * Run after `npm install` (requires devDependency `sharp`).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const svgPath = path.join(root, "public", "tv-logo-placeholder.svg");
const outDir = path.join(root, "public", "icons");

const bg = { r: 5, g: 6, b: 13, alpha: 1 };

async function main() {
  if (!fs.existsSync(svgPath)) {
    console.error("Missing", svgPath);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const svg = fs.readFileSync(svgPath);

  await sharp(svg).resize(192, 192, { fit: "contain", background: bg }).png().toFile(path.join(outDir, "icon-192.png"));

  await sharp(svg).resize(512, 512, { fit: "contain", background: bg }).png().toFile(path.join(outDir, "icon-512.png"));

  // Maskable: content in ~78% center safe zone (Android adaptive icon)
  const inner = 400;
  const pad = Math.floor((512 - inner) / 2);
  await sharp(svg)
    .resize(inner, inner, { fit: "contain", background: bg })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: bg })
    .png()
    .toFile(path.join(outDir, "icon-maskable-512.png"));

  await sharp(svg).resize(180, 180, { fit: "contain", background: bg }).png().toFile(path.join(outDir, "apple-touch-icon.png"));

  console.log("Wrote:", path.join("public", "icons", "*.png"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
