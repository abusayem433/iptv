/**
 * Fetch IPTV-/channels.json from GitHub and append entries not already in data/channels.json.
 * Only HLS (.m3u8) URLs are added — they work with hls.js + /api/hls-proxy.
 *
 * Run: node scripts/merge-github-channels.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dataPath = path.join(root, "data", "channels.json");
const REMOTE =
  "https://raw.githubusercontent.com/foridul422/IPTV-/main/channels.json";

function slugGroup(group) {
  return String(group || "other")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "other";
}

function titleCaseFromId(id) {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function isPlayableHls(url) {
  if (!url || typeof url !== "string") return false;
  const u = url.trim().toLowerCase();
  if (!u.startsWith("http://") && !u.startsWith("https://")) return false;
  if (u.includes("youtube.com") || u.includes("youtu.be")) return false;
  return u.includes(".m3u8");
}

function rebuildCategories(channels) {
  const counts = new Map();
  for (const ch of channels) {
    counts.set(ch.category, (counts.get(ch.category) || 0) + 1);
  }
  const ids = [...counts.keys()].sort((a, b) => titleCaseFromId(a).localeCompare(titleCaseFromId(b)));
  return ids.map((id) => ({
    id,
    title: `${titleCaseFromId(id)} (${counts.get(id)} CHANNEL)`,
  }));
}

async function main() {
  if (!fs.existsSync(dataPath)) {
    console.error("Missing", dataPath, "— run npm run parse-channels first.");
    process.exit(1);
  }

  const local = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  if (!Array.isArray(local.channels)) {
    console.error("Invalid channels.json: expected .channels array");
    process.exit(1);
  }

  const existingUrls = new Set(local.channels.map((c) => c.streamUrl));

  console.log("Fetching", REMOTE);
  const res = await fetch(REMOTE, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    console.error("Fetch failed:", res.status, res.statusText);
    process.exit(1);
  }

  const remote = await res.json();
  if (!Array.isArray(remote)) {
    console.error("Remote JSON is not an array");
    process.exit(1);
  }

  const additions = [];
  let skippedDup = 0;
  let skippedNonHls = 0;
  let skippedBad = 0;

  for (const row of remote) {
    const url = row.url;
    const name = (row.name || "Unknown").trim();
    const logo = row.logo || "";
    const group = row.group || "Other";

    if (!url || !name) {
      skippedBad++;
      continue;
    }
    if (!isPlayableHls(url)) {
      skippedNonHls++;
      continue;
    }
    if (existingUrls.has(url)) {
      skippedDup++;
      continue;
    }

    existingUrls.add(url);
    const category = slugGroup(group);
    additions.push({
      category,
      name,
      streamUrl: url,
      logoUrl: logo,
      logoAlt: name,
    });
  }

  const mergedChannels = [...local.channels, ...additions];
  const out = {
    generatedAt: new Date().toISOString(),
    categories: rebuildCategories(mergedChannels),
    channels: mergedChannels,
  };

  fs.writeFileSync(dataPath, JSON.stringify(out, null, 2), "utf8");
  console.log("Done.");
  console.log("  Local channels before:", local.channels.length);
  console.log("  Added (new .m3u8 URLs):", additions.length);
  console.log("  Total channels now:", mergedChannels.length);
  console.log("  Skipped (already had URL):", skippedDup);
  console.log("  Skipped (not HLS / YouTube):", skippedNonHls);
  console.log("  Skipped (bad row):", skippedBad);
  console.log("  Wrote:", dataPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
