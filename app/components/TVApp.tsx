"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { VideoPlayer } from "./VideoPlayer";
import { hlsProxyUrl } from "@/lib/hlsProxyUrl";

export type Channel = {
  category: string;
  name: string;
  streamUrl: string;
  logoUrl: string;
  logoAlt: string;
};

export type CategoryMeta = { id: string; title: string };

type Payload = {
  categories: CategoryMeta[];
  channels: Channel[];
};

type ViewFilter = "all" | "favorites";

type Theme = "dark" | "light";

type RecentEntry = { streamUrl: string; at: number };

/**
 * Favorites are stored only in the browser (localStorage) — ordered list of `streamUrl`.
 */
const FAV_STORAGE_KEY = "sayem-tv-favorites";
const LEGACY_FAV_STORAGE_KEY = "iptv-tvstream-favorites";
const RECENT_STORAGE_KEY = "sayem-tv-recent";
const THEME_STORAGE_KEY = "sayem-tv-theme";
const PAGE_SIZE = 72;
const MAX_RECENT = 20;

function readFavoritesOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    let raw = localStorage.getItem(FAV_STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(LEGACY_FAV_STORAGE_KEY);
      if (raw) {
        try {
          localStorage.setItem(FAV_STORAGE_KEY, raw);
        } catch {
          /* quota */
        }
      }
    }
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const urls = arr.filter((x): x is string => typeof x === "string");
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of urls) {
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  } catch {
    return [];
  }
}

function writeFavoritesOrder(urls: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(urls));
  } catch {
    /* private mode / quota */
  }
}

function readRecent(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is RecentEntry => {
        if (!x || typeof x !== "object") return false;
        const o = x as Record<string, unknown>;
        return typeof o.streamUrl === "string";
      })
      .map((x) => {
        const o = x as RecentEntry;
        return {
          streamUrl: o.streamUrl,
          at: typeof o.at === "number" ? o.at : Date.now(),
        };
      })
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function writeRecent(entries: RecentEntry[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
}

function readTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = theme === "light" ? "#e8ebf4" : "#05060d";
}

function getDefaultCategoryId(channels: Channel[]): string {
  return channels.some((ch) => ch.category === "sports") ? "sports" : "all";
}

function humanCategory(id: string, title: string): string {
  const t = title.replace(/\s*\([^)]*CHANNEL[^)]*\)\s*/gi, "").trim();
  if (t.length > 2) return t;
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function reorderArray<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function TVApp() {
  const [data, setData] = useState<Payload | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [cat, setCat] = useState<string>("sports");
  const [q, setQ] = useState("");
  const [view, setView] = useState<ViewFilter>("all");
  const [favOrder, setFavOrder] = useState<string[]>(() => []);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [active, setActive] = useState<Channel | null>(null);
  const [origin, setOrigin] = useState("");
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
  const [theme, setTheme] = useState<Theme>("dark");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const favSet = useMemo(() => new Set(favOrder), [favOrder]);

  useEffect(() => {
    setOrigin(window.location.origin);
    setFavOrder(readFavoritesOrder());
    const t = readTheme();
    setTheme(t);
    applyTheme(t);
  }, []);

  useEffect(() => {
    fetch("/api/channels")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: Payload) => {
        setData(j);
        const defaultCat = getDefaultCategoryId(j.channels);
        setCat(defaultCat);
        const first = j.channels.find((ch) => ch.category === defaultCat) ?? j.channels[0];
        if (first) setActive(first);
      })
      .catch((e: Error) => setLoadErr(e.message));
  }, []);

  const categoryLabel = useMemo(() => {
    const m = new Map<string, string>();
    data?.categories.forEach((c) => {
      m.set(c.id, humanCategory(c.id, c.title));
    });
    return (id: string) => m.get(id) ?? id;
  }, [data]);

  const isFavReorderMode = view === "favorites" && cat === "all" && q.trim() === "";

  const filtered = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    let list: Channel[];

    if (view === "favorites") {
      const byUrl = new Map(data.channels.map((ch) => [ch.streamUrl, ch]));
      list = favOrder.map((url) => byUrl.get(url)).filter((ch): ch is Channel => !!ch);
    } else {
      list = data.channels;
    }

    if (cat !== "all") {
      list = list.filter((ch) => ch.category === cat);
    }
    if (term) {
      list = list.filter((ch) => {
        if (ch.name.toLowerCase().includes(term)) return true;
        const lab = categoryLabel(ch.category).toLowerCase();
        if (lab.includes(term)) return true;
        if (ch.category.toLowerCase().includes(term)) return true;
        if (ch.logoAlt.toLowerCase().includes(term)) return true;
        return false;
      });
    }

    return list;
  }, [data, cat, q, view, favOrder, categoryLabel]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [cat, q, view, favOrder.length]);

  useEffect(() => {
    if (isFavReorderMode) {
      setVisibleCount((n) => Math.max(n, filtered.length));
    }
  }, [isFavReorderMode, filtered.length]);

  const effectiveCap = isFavReorderMode ? filtered.length : visibleCount;
  const visibleChannels = useMemo(() => filtered.slice(0, effectiveCap), [filtered, effectiveCap]);

  const continueChannels = useMemo(() => {
    if (!data) return [];
    const byUrl = new Map(data.channels.map((ch) => [ch.streamUrl, ch]));
    return recentEntries.map((e) => byUrl.get(e.streamUrl)).filter((ch): ch is Channel => !!ch);
  }, [data, recentEntries]);

  useEffect(() => {
    if (!data || !active) return;
    setRecentEntries((prev) => {
      const base = prev.length === 0 ? readRecent() : prev;
      const rest = base.filter((r) => r.streamUrl !== active.streamUrl);
      const next = [{ streamUrl: active.streamUrl, at: Date.now() }, ...rest].slice(0, MAX_RECENT);
      writeRecent(next);
      return next;
    });
  }, [data, active?.streamUrl]);

  const proxiedSrc = useMemo(() => {
    if (!active || !origin) return "";
    return hlsProxyUrl(origin, active.streamUrl);
  }, [active, origin]);

  const onPick = useCallback((ch: Channel) => {
    setActive(ch);
  }, []);

  const toggleFav = useCallback((streamUrl: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFavOrder((prev) => {
      const i = prev.indexOf(streamUrl);
      const next = i >= 0 ? prev.filter((u) => u !== streamUrl) : [...prev, streamUrl];
      writeFavoritesOrder(next);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    if (!data) return;
    const dc = getDefaultCategoryId(data.channels);
    setCat(dc);
    setQ("");
    setView("all");
    const first = data.channels.find((ch) => ch.category === dc) ?? data.channels[0];
    if (first) setActive(first);
  }, [data]);

  const clearContinue = useCallback(() => {
    writeRecent([]);
    setRecentEntries([]);
  }, []);

  const setThemeChoice = useCallback((t: Theme) => {
    setTheme(t);
    applyTheme(t);
  }, []);

  const onDragStartFav = useCallback(
    (e: React.DragEvent, index: number) => {
      if (!isFavReorderMode) return;
      e.stopPropagation();
      e.dataTransfer.setData("text/plain", String(index));
      e.dataTransfer.effectAllowed = "move";
      setDragIdx(index);
    },
    [isFavReorderMode]
  );

  const onDragEndFav = useCallback(() => {
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  const onDragOverFav = useCallback(
    (e: React.DragEvent, index: number) => {
      if (!isFavReorderMode) return;
      e.preventDefault();
      setDragOverIdx(index);
    },
    [isFavReorderMode]
  );

  const onDropFav = useCallback(
    (e: React.DragEvent, dropIndex: number) => {
      if (!isFavReorderMode) return;
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
      setDragIdx(null);
      setDragOverIdx(null);
      if (Number.isNaN(from) || from === dropIndex) return;
      setFavOrder((prev) => {
        const next = reorderArray(prev, from, dropIndex);
        writeFavoritesOrder(next);
        return next;
      });
    },
    [isFavReorderMode]
  );

  const defaultCatId = useMemo(
    () => (data ? getDefaultCategoryId(data.channels) : "sports"),
    [data]
  );

  const hasActiveFilters =
    !!data && (cat !== defaultCatId || q.trim() !== "" || view !== "all");

  if (loadErr) {
    return (
      <div className="notice error">
        Could not load channel list ({loadErr}). Ensure <code>data/channels.json</code> exists — run{" "}
        <code>npm run parse-channels</code>.
      </div>
    );
  }

  if (!data) {
    return <div className="notice">Loading channels…</div>;
  }

  return (
    <div className="tv-layout">
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <h1>SAYEM TV</h1>
            <p className="tagline">Live channels in your browser</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="theme-toggle" role="group" aria-label="Color theme">
            <button
              type="button"
              className={theme === "dark" ? "active" : ""}
              onClick={() => setThemeChoice("dark")}
              aria-pressed={theme === "dark"}
            >
              Dark
            </button>
            <button
              type="button"
              className={theme === "light" ? "active" : ""}
              onClick={() => setThemeChoice("light")}
              aria-pressed={theme === "light"}
            >
              Light
            </button>
          </div>
          {active ? (
            <div className="now-playing" aria-live="polite">
              <span className="np-label">Now playing</span>
              <span className="np-title">{active.name}</span>
            </div>
          ) : null}
        </div>
      </header>

      <section className="player-section">
        {active && proxiedSrc ? (
          <VideoPlayer key={proxiedSrc} src={proxiedSrc} channelName={active.name} />
        ) : (
          <div className="player-placeholder">Select a channel</div>
        )}
      </section>

      {continueChannels.length > 0 ? (
        <section className="continue-section" aria-labelledby="continue-heading">
          <div className="continue-head">
            <h2 id="continue-heading" className="continue-title">
              Continue watching
            </h2>
            <button type="button" className="btn-text" onClick={clearContinue}>
              Clear
            </button>
          </div>
          <div className="continue-scroll" role="list">
            {continueChannels.map((ch) => (
              <button
                key={ch.streamUrl}
                type="button"
                role="listitem"
                className={`continue-card ${active?.streamUrl === ch.streamUrl ? "is-playing" : ""}`}
                onClick={() => onPick(ch)}
              >
                <div className="continue-logo">
                  <img
                    src={ch.logoUrl?.trim() ? ch.logoUrl : "/tv-logo-placeholder.svg"}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      const el = e.currentTarget;
                      if (el.dataset.fallback === "1") return;
                      el.dataset.fallback = "1";
                      el.src = "/tv-logo-placeholder.svg";
                    }}
                  />
                </div>
                <span className="continue-name">{ch.name}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="filter-panel" aria-label="Channel filters">
        <div className="filter-panel-top">
          <input
            type="search"
            className="search search-toolbar search-full"
            placeholder="Search channels and categories…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search by channel name, category, or tag"
          />
        </div>

        <div className="filter-panel-toolbar">
          <div className="segmented" role="group" aria-label="Library scope">
            <button
              type="button"
              className={view === "all" ? "seg active" : "seg"}
              onClick={() => setView("all")}
            >
              All
            </button>
            <button
              type="button"
              className={view === "favorites" ? "seg active" : "seg"}
              onClick={() => setView("favorites")}
            >
              Favorites
              {favOrder.length > 0 ? <span className="seg-badge">{favOrder.length}</span> : null}
            </button>
          </div>

          <div className="toolbar-end">
            <span className="count-pill" title="Matching / total channels">
              {filtered.length} / {data.channels.length}
            </span>

            {hasActiveFilters ? (
              <button type="button" className="btn-ghost btn-toolbar-clear" onClick={clearFilters}>
                Reset
              </button>
            ) : null}
          </div>
        </div>

        <div className="filter-panel-category">
          <label className="cat-picker-label" htmlFor="category-select">
            Category
          </label>
          <select
            id="category-select"
            className="select select-cat"
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryLabel(c.id)}
              </option>
            ))}
          </select>
        </div>
      </section>

      {view === "favorites" && favOrder.length > 1 && !isFavReorderMode ? (
        <p className="reorder-hint">
          To drag and reorder favorites, open <strong>Favorites</strong>, choose <strong>All categories</strong>, and
          clear the search box.
        </p>
      ) : null}

      {isFavReorderMode ? (
        <p className="reorder-hint" role="status">
          Drag the <strong>⋮⋮</strong> handle on each card to reorder favorites. Order is saved on this device only.
        </p>
      ) : null}

      <div className="channel-grid">
        {visibleChannels.map((ch, idx) => {
          const isFav = favSet.has(ch.streamUrl);
          return (
            <div
              key={ch.streamUrl}
              className={`ch-cell ${isFavReorderMode ? "has-drag-handle" : ""} ${dragIdx === idx ? "is-dragging" : ""} ${dragOverIdx === idx ? "drag-over" : ""}`}
              onDragOver={(e) => onDragOverFav(e, idx)}
              onDrop={(e) => onDropFav(e, idx)}
            >
              {isFavReorderMode ? (
                <div
                  className="ch-drag-handle"
                  draggable
                  onDragStart={(e) => onDragStartFav(e, idx)}
                  onDragEnd={onDragEndFav}
                  title="Drag to reorder"
                  aria-label={`Reorder ${ch.name}`}
                >
                  <span aria-hidden>⋮⋮</span>
                </div>
              ) : null}
              <button
                type="button"
                draggable={false}
                className={`ch-fav-btn ${isFav ? "is-fav" : ""}`}
                onClick={(e) => toggleFav(ch.streamUrl, e)}
                aria-pressed={isFav}
                aria-label={isFav ? `Remove ${ch.name} from favorites` : `Add ${ch.name} to favorites`}
                title={isFav ? "Remove from favorites" : "Add to favorites"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={isFav ? "currentColor" : "none"} aria-hidden>
                  <path
                    stroke="currentColor"
                    strokeWidth="1.75"
                    d="M12 3.2l2.35 4.76 5.26.77-3.8 3.7.9 5.24L12 15.9l-4.7 2.47.9-5.24-3.8-3.7 5.26-.77L12 3.2z"
                  />
                </svg>
              </button>
              <button
                type="button"
                draggable={false}
                className={active?.streamUrl === ch.streamUrl ? "ch-card playing" : "ch-card"}
                onClick={() => onPick(ch)}
              >
                <span className="ch-logo-wrap">
                  <img
                    src={ch.logoUrl?.trim() ? ch.logoUrl : "/tv-logo-placeholder.svg"}
                    alt=""
                    className="ch-logo"
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      const el = e.currentTarget;
                      if (el.dataset.fallback === "1") return;
                      el.dataset.fallback = "1";
                      el.src = "/tv-logo-placeholder.svg";
                    }}
                  />
                </span>
                <span className="ch-name">{ch.name}</span>
                <span className="ch-cat">{categoryLabel(ch.category)}</span>
              </button>
            </div>
          );
        })}
      </div>

      {!isFavReorderMode && visibleCount < filtered.length ? (
        <div className="load-more-wrap">
          <button type="button" className="btn-load-more" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
            Load more ({filtered.length - visibleCount} left)
          </button>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="empty">
          {view === "favorites" && favOrder.length === 0
            ? "No favorites yet. Use the star on a channel card to save it here."
            : "No channels match your filters."}
        </p>
      ) : null}
    </div>
  );
}
