# SAYEM TV (Next.js)

Web UI for **SAYEM TV** — browse and play **HLS** (`.m3u8`) channels. The channel list is generated from a structured HTML export (see below) and/or merged from external JSON. Streams use a **same-origin HLS proxy** so playlists and segments are not blocked by browser CORS rules.

## Repository layout

```
app/                    # Next.js App Router (includes manifest.ts → Web App Manifest)
data/
  channels.json         # Generated channel list (served by GET /api/channels)
  source/               # Parser inputs — not served by the app
    README.md
    channel-directory-export.html   # Replace + re-run parse when you refresh the export
lib/                    # Shared helpers (HLS rewrite, proxy URL, SSRF checks)
scripts/
  parse-channel-export.mjs   # HTML export → channels.json
  merge-github-channels.mjs  # Optional: append new URLs from a remote JSON list
  validate-and-fix-logos.mjs # Optional: verify/fix logoUrl in channels.json
  list-placeholder-logos.mjs   # Report channels still on the placeholder logo
public/
  icons/                # PWA / Apple touch icons (PNG)
```

## Setup

```bash
npm install
```

## Refreshing channels from the HTML export

1. Replace `data/source/channel-directory-export.html` with your latest full-page export (same DOM patterns: `.category-section`, `.channel-item`, `playChannel('…m3u8…', …, 'Name')`).
2. Run:

```bash
npm run parse-channels
```

Optional custom path:

```bash
node scripts/parse-channel-export.mjs /path/to/your-export.html
```

**Note:** `parse-channels` rebuilds `data/channels.json` **only** from the HTML export. If you also use `merge-github-channels`, run that **after** `parse-channels` so appended URLs are not wiped.

## Channel logos (audit and repair)

The UI falls back to `public/tv-logo-placeholder.svg` when a `logoUrl` is missing or fails to load in the browser. To **check every channel** in `data/channels.json` (HTTP status, size, image magic bytes) and fix bad or empty URLs offline:

```bash
npm run fix-logos
```

That is a **dry run**: it prints counts and a summary only. To write updates back to `data/channels.json` (and refresh `generatedAt`):

```bash
npm run fix-logos -- --write
```

Broken or empty logos are replaced when possible with an **English Wikipedia** thumbnail URL for the channel name (best effort, rate-limited). If nothing suitable is found, `logoUrl` is set to `/tv-logo-placeholder.svg`. A full pass can take several minutes because of network checks and Wikipedia delays; progress is printed every 50 channels. **Do not pipe the command through `tail`** if you want to see progress while it runs.

Many failures are **transient** (for example HTTP **429** rate limits on logo CDNs). Running `npm run fix-logos -- --write` again later can recover some URLs without manual work.

### Manual logos (after Wikipedia / CDN failures)

Each channel in `data/channels.json` has:

- **`logoUrl`** — must be a direct link to an image (`https://…` to PNG/JPEG/WebP/SVG/GIF, or a path under this site such as **`/channel-logos/name.png`**).
- **`logoAlt`** — description for screen readers (usually the channel name).

**Ways to supply an image**

1. **Hosted URL** — Use a stable `https://` image URL you are allowed to hotlink (respect copyright and terms of the host). After editing, run `npm run fix-logos` (dry-run) to confirm the URL returns a real image.
2. **Files in this repo** — Add PNGs (or other web formats) under e.g. **`public/channel-logos/`**, then set `"logoUrl": "/channel-logos/gb-news.png"` for that channel. Paths are served as static files by Next.js.

**Work queue for placeholders**

List every channel that still uses the placeholder (for spreadsheets or manual editing):

```bash
npm run list-placeholder-logos
npm run list-placeholder-logos -- --csv   # also writes data/logo-placeholders.csv
```

That writes **`data/logo-placeholders.report.json`** with `name`, `category`, `streamUrl`, and an empty `logoUrl` field you can fill while searching, then merge back into `channels.json` (or edit `channels.json` directly in your editor using the same `streamUrl` / `name` to find the row).

## Merging additional HLS URLs from GitHub

To append **new** `.m3u8` rows from [this example `channels.json`](https://raw.githubusercontent.com/foridul422/IPTV-/main/channels.json) that are not already in `data/channels.json`:

```bash
npm run merge-github-channels
```

YouTube and non-`.m3u8` links are skipped (not supported by the current player). The script prints a short summary when it finishes.

## Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Install as an app (PWA)

The site ships a **Web App Manifest** (`app/manifest.ts` → `/manifest.webmanifest`) with **standalone** display, theme colors, and icons under `public/icons/`. That enables:

- **Android (Chrome):** menu → **Install app** or the install banner when criteria are met (usually **HTTPS** in production; `localhost` is fine for dev).
- **iPhone / iPad (Safari):** **Share** → **Add to Home Screen** (uses `apple-touch-icon` and full-screen–style metadata).
- **Desktop (Chrome / Edge on macOS or Windows):** install icon in the address bar or **Install SAYEM TV** from the menu.

For correct absolute URLs in metadata when you deploy, set your public origin (example for Vercel):

```bash
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

After changing `public/tv-logo-placeholder.svg`, regenerate PNGs:

```bash
npm run generate-pwa-icons
```

## How playback works

- `GET /api/channels` serves `data/channels.json`.
- `GET /api/hls-proxy?url=…` fetches upstream HLS; for playlist bodies it rewrites URLs so child playlists and segments also go through the proxy. Only `http`/`https` URLs are allowed; **private/local IP ranges are blocked** to reduce SSRF risk. Do not expose this proxy to the public internet without stronger controls.
- **Picture-in-picture:** the player asks the browser for PiP when the tab becomes hidden (switching tabs / some minimize cases) and exposes a **PiP** button above the controls. Behavior depends on the browser (some require you to use the PiP button once first); iOS Safari support is limited.

## Notes

- **Favorites** are stored under `sayem-tv-favorites` as an **ordered** JSON array of `streamUrl` strings (order is used in the Favorites view). On first load after the rebrand, data is copied from `iptv-tvstream-favorites` if present. **Drag-and-drop reorder** is available in Favorites when **All categories** is selected and the search box is empty; use the **⋮⋮** handle on each card.
- **Continue watching** uses `sayem-tv-recent` (last watched channels, newest first, device only). Clear from the strip’s **Clear** control.
- **Theme** (`dark` default / `light`) is stored under `sayem-tv-theme` and applied to the page before paint when possible (see `app/layout.tsx` boot script).
- Nothing is written to a server or database for the above; clearing site data or another device starts fresh.
- Many stream URLs use **time-limited tokens**; when they expire, refresh your export or remote list and regenerate/merge `channels.json`.
- Playback depends on third-party origins (geo, DRM, provider policy).

## Legal

Only use streams you have the right to access. This project is a player shell around data you supply.
