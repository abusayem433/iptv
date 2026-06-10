/**
 * List channels whose logoUrl is the local placeholder (for manual curation).
 *
 *   node scripts/list-placeholder-logos.mjs
 *   node scripts/list-placeholder-logos.mjs --csv   # also writes data/logo-placeholders.csv
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dataPath = path.join(root, "data", "channels.json");
const PLACEHOLDER = "/tv-logo-placeholder.svg";

function main() {
  const wantCsv = process.argv.includes("--csv");
  const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const channels = raw.channels;
  if (!Array.isArray(channels)) {
    console.error("Invalid channels.json");
    process.exit(1);
  }

  const rows = channels.filter((ch) => (ch.logoUrl || "").trim() === PLACEHOLDER);

  const out = rows.map((ch) => ({
    name: ch.name,
    category: ch.category,
    streamUrl: ch.streamUrl,
    logoAlt: ch.logoAlt || ch.name,
    /** Paste a working image URL here, or e.g. /channel-logos/my-file.png */
    logoUrl: "",
  }));

  const jsonPath = path.join(root, "data", "logo-placeholders.report.json");
  fs.writeFileSync(jsonPath, JSON.stringify({ count: out.length, channels: out }, null, 2), "utf8");
  console.log(`Wrote ${out.length} rows → ${path.relative(root, jsonPath)}`);

  if (wantCsv) {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const header = ["name", "category", "streamUrl", "logoAlt", "logoUrl_suggestion"].join(",");
    const lines = rows.map((ch) =>
      [esc(ch.name), esc(ch.category), esc(ch.streamUrl), esc(ch.logoAlt || ch.name), '""'].join(",")
    );
    const csvPath = path.join(root, "data", "logo-placeholders.csv");
    fs.writeFileSync(csvPath, [header, ...lines].join("\n"), "utf8");
    console.log(`Wrote CSV → ${path.relative(root, csvPath)}`);
  }
}

main();
