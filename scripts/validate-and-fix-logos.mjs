/**
 * Validate channel logo URLs (HTTP + image sniff) and fix broken / empty entries.
 * Tries English Wikipedia thumbnail when possible; otherwise uses /tv-logo-placeholder.svg
 *
 *   node scripts/validate-and-fix-logos.mjs           # dry-run: report only
 *   node scripts/validate-and-fix-logos.mjs --write # update data/channels.json
 *
 * Respect upstream rate limits; Wikipedia calls are serialized with a short delay.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dataPath = path.join(root, "data", "channels.json");

const PLACEHOLDER = "/tv-logo-placeholder.svg";
const FETCH_TIMEOUT_MS = 12_000;
const LOGO_CHECK_CONCURRENCY = 10;
const WIKI_DELAY_MS = 200;

const UA = {
  "User-Agent": "sayem-tv-logo-audit/1.0 (local tooling; respectful fetch)",
  Accept: "*/*",
};

function looksLikeImageBytes(buf) {
  const u = new Uint8Array(buf);
  if (u.length < 12) return false;
  if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return true;
  if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) return true;
  if (u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46) return true;
  if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46) {
    const tag = String.fromCharCode(u[8], u[9], u[10], u[11]);
    return tag === "WEBP";
  }
  if (u[0] === 0x3c || u[0] === 0x7b) return false;
  return false;
}

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: "follow" });
  } finally {
    clearTimeout(t);
  }
}

/** Returns { ok } | { ok: false, reason } */
async function verifyLogoUrl(url) {
  if (!url || typeof url !== "string" || !url.trim()) {
    return { ok: false, reason: "empty" };
  }
  const trimmed = url.trim();
  if (trimmed.startsWith("/") && trimmed.endsWith(".svg")) {
    return { ok: true, reason: "local_placeholder" };
  }
  try {
    const r = await fetchWithTimeout(trimmed, { headers: UA });
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 32) return { ok: false, reason: "too_small" };
    if (ct.includes("image/")) return { ok: true };
    if (ct.includes("application/octet-stream") || ct.includes("binary")) {
      if (looksLikeImageBytes(buf)) return { ok: true };
    }
    if (looksLikeImageBytes(buf)) return { ok: true };
    return { ok: false, reason: `not_image_${ct.slice(0, 40)}` };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { ok: false, reason: name === "AbortError" ? "timeout" : "fetch_error" };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const wikiCache = new Map();

async function wikipediaThumbnailForChannelName(name) {
  const key = name.trim().toLowerCase();
  if (wikiCache.has(key)) return wikiCache.get(key);

  await sleep(WIKI_DELAY_MS);

  const headers = {
    ...UA,
    Accept: "application/json",
  };

  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      name + " tv"
    )}&format=json&srlimit=5`;
    const sr = await fetchWithTimeout(searchUrl, { headers });
    if (!sr.ok) {
      wikiCache.set(key, null);
      return null;
    }
    const sj = await sr.json();
    const hits = sj.query?.search;
    if (!Array.isArray(hits) || hits.length === 0) {
      wikiCache.set(key, null);
      return null;
    }

    for (const hit of hits) {
      await sleep(WIKI_DELAY_MS);
      const imgUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
        hit.title
      )}&prop=pageimages&format=json&pithumbsize=220&redirects=1`;
      const ir = await fetchWithTimeout(imgUrl, { headers });
      if (!ir.ok) continue;
      const ij = await ir.json();
      const pages = ij.query?.pages;
      if (!pages) continue;
      const page = Object.values(pages)[0];
      const src = page?.thumbnail?.source;
      if (!src || typeof src !== "string") continue;
      const v = await verifyLogoUrl(src);
      if (v.ok) {
        wikiCache.set(key, src);
        return src;
      }
    }
  } catch {
    wikiCache.set(key, null);
    return null;
  }

  wikiCache.set(key, null);
  return null;
}

async function mapPool(items, limit, fn, onProgress) {
  const ret = new Array(items.length);
  let i = 0;
  let completed = 0;
  async function worker() {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) break;
      ret[idx] = await fn(items[idx], idx);
      const c = ++completed;
      if (onProgress && (c % 50 === 0 || c === items.length)) {
        process.stderr.write(`\rLogo check progress: ${c}/${items.length}`);
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  if (onProgress && items.length > 0) process.stderr.write("\n");
  return ret;
}

async function main() {
  const doWrite = process.argv.includes("--write");
  if (!fs.existsSync(dataPath)) {
    console.error("Missing", dataPath);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  if (!Array.isArray(raw.channels)) {
    console.error("Invalid channels.json");
    process.exit(1);
  }

  const channels = raw.channels;
  console.log(`Checking ${channels.length} logo URLs (concurrency ${LOGO_CHECK_CONCURRENCY})…`);

  const checkResults = await mapPool(
    channels,
    LOGO_CHECK_CONCURRENCY,
    async (ch) => {
      const v = await verifyLogoUrl(ch.logoUrl);
      return { ch, v };
    },
    true
  );

  const stats = {
    ok: 0,
    empty: 0,
    fixedWiki: 0,
    fixedPlaceholder: 0,
    reasons: {},
  };

  const toFix = [];

  for (const { ch, v } of checkResults) {
    if (v.ok) {
      stats.ok++;
      continue;
    }
    stats.reasons[v.reason] = (stats.reasons[v.reason] || 0) + 1;
    if (v.reason === "empty") stats.empty++;
    toFix.push({ ch, reason: v.reason });
  }

  console.log(`\nInitial scan: ${stats.ok} OK, ${toFix.length} need replacement.`);
  console.log("Reasons:", stats.reasons);

  if (toFix.length === 0) {
    console.log("\nNothing to fix.");
    return;
  }

  console.log(`\nResolving ${toFix.length} logos (Wikipedia, then placeholder)…`);

  for (const { ch, reason } of toFix) {
    const wikiUrl = await wikipediaThumbnailForChannelName(ch.name);
    if (wikiUrl) {
      ch.logoUrl = wikiUrl;
      ch.logoAlt = ch.name;
      stats.fixedWiki++;
      process.stdout.write(".");
    } else {
      ch.logoUrl = PLACEHOLDER;
      ch.logoAlt = ch.name;
      stats.fixedPlaceholder++;
      process.stdout.write("x");
    }
  }
  process.stdout.write("\n");

  console.log("\nSummary:");
  console.log("  Kept OK:           ", stats.ok);
  console.log("  Fixed (Wikipedia): ", stats.fixedWiki);
  console.log("  Fixed (placeholder):", stats.fixedPlaceholder);

  if (doWrite) {
    raw.generatedAt = new Date().toISOString();
    fs.writeFileSync(dataPath, JSON.stringify(raw, null, 2), "utf8");
    console.log("\nWrote:", dataPath);
  } else {
    console.log("\nDry-run only. Re-run with --write to save changes.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
