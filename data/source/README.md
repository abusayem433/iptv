# Source data (not served by the app)

Files in this directory are **inputs** for build scripts. They are not exposed by Next.js routes.

| File | Purpose |
|------|--------|
| `channel-directory-export.html` | Full-page HTML export of a channel directory (category sections + `playChannel(…)` entries). Replace this file when you have a fresh export, then run `npm run parse-channels` to regenerate `data/channels.json`. |

The parser looks for the markup patterns used by that export (e.g. `.category-section`, `.channel-item`, HLS URLs in `onclick` handlers). If your export format changes, update `scripts/parse-channel-export.mjs` accordingly.
