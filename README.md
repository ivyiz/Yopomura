# Yopomura

**A desktop manga, comic and book reader with a built-in browser, a downloadable-image pipeline and a local media player**

Yopomura is an Electron + React desktop app for reading local manga, comics, webtoons, PDFs and EPUB novels. It also ships an integrated Chromium browser, a downloader that fetches pages and images from URLs you give it, a video/media library, a retention-based trash and full profile backups.

[![Github Latest Release](https://img.shields.io/github/v/tag/ivyiz/Yopomura?label=release&style=flat-square&logo=github)](https://github.com/ivyiz/Yopomura/releases/latest) |
[![Github All Releases](https://img.shields.io/github/downloads/ivyiz/Yopomura/total.svg?style=flat-square&logo=github)](https://github.com/ivyiz/Yopomura/releases) |
[![License](https://img.shields.io/github/license/ivyiz/Yopomura?style=flat-square)](LICENSE)

[Privacy Policy](PRIVACY.md) • [Disclaimer](DISCLAIMER.md) • [User Guide](docs/GUIDE.md)

## What's Inside

- **Reader** — vertical, left-to-right and right-to-left modes, dual-page spreads, webtoon scrolling, Zen mode, custom themes and keybindings.
- **Downloader** — resolves pages through declarative site recipes, an optional site-extractor overlay and a generic Chromium browser resolver. Review images before anything is written, then queue, pause, resume or cancel.
- **Browser** — tabs, bookmarks, ad blocking, browser-only proxy, force dark, link scanning and one-click "send page to Downloader".
- **Media** — MP4/WebM library, playlists, resume position, speed control, theater mode, picture-in-picture and fullscreen.
- **Library tools** — bookmarks, reading history, search/filter, multiple windows, trash with retention, and profile ZIP backup/restore.
- **Integrations** — AniList progress sync, TachiDesk-compatible download folders, community translation packs.

## Reading Experience

- **Multiple Reading Modes**: vertical scroll, left-to-right, right-to-left navigation
- **Zen Mode**: distraction-free fullscreen reading with optional cursor hiding and page/progress display
- **Custom Scrolling**: adjustable scroll speed with keyboard navigation
- **Dual Page View**: side-by-side page display for manga/comics
- **Webtoon Support**: seamless vertical scrolling with no gaps
- **Image Controls**: fit modes, brightness/custom color filters, page gaps and margins
- **EPUB Reader**: font size, family, margins, notes and per-book settings

## Downloader

The downloader is not just a generic file saver. For each URL it tries the following, in order:

1. **Matching recipe** — a declarative JSON recipe for the host, with optional chapter lists, page selectors, next-page rules and a sandboxed script hook.
2. **Site extractor** — if the build provides one (see `YOPOMURA_DOWNLOADER_EXTRACTOR_PATH` / `MODULE`), it resolves titles, chapter links and page images directly.
3. **Generic browser resolver** — a hidden Chromium page loads the URL, scrolls it and collects the image URLs it finds.
4. **`gallery-dl` fallback** — optional, for sites that `gallery-dl` already supports.

A host that needed the browser resolver is remembered for 7 days, so repeat jobs skip the slower probe.

### Download workflow

- **Preview / Probe**: detect title, mode, chapter count, image count, resolver source and sample image URLs before queueing a job.
- **Image review**: every resolved image is shown with a checkbox, so you can uncheck pages before confirming. Set `YOPOMURA_DOWNLOADER_REVIEW=0` to skip this step.
- **Queue**: jobs run one at a time (FIFO); you can pause the active job and hold the queue, then resume from `.part` files.
- **Output**: `001.jpg`, `002.png`, ... packed into `<title>.zip`, or kept as a folder with `keepFolder`.
- **History**: recent downloads and their output paths stay available in the Downloader panel.
- **Safety**: output paths are confined to the chosen folder, titles are sanitized, and video URLs are skipped so a manga job never writes `.mp4`/`.webm` files.
- **Resilience**: up to 4 retries with backoff, `429 Retry-After` support, atomic renames and one reduced-concurrency retry pass.

### Recipes

Recipes let one build adapt to many sites without a rebuild. Imports live in `userData/downloader-recipes/`.

- Import/export JSON recipes from **Downloader → Sites**.
- Build one visually: right-click in the browser → **Create downloader recipe**, click a chapter link, a page image and optionally a next-page button.
- Review, test and save the draft in the **Recipe Editor**.
- Supported modes: `series`, `reader`, `gallery`, `auto`. Selector attributes can include `srcset` (largest candidate wins) and `exclude` rules.
- Script recipes run inside the sandboxed recipe browser page (no Node integration, no filesystem access). Only use scripts you trust.

See [Downloader recipes](docs/downloader-recipes.md) for the schema and examples.

### Worker protocol

The Electron app spawns a headless Python worker (`downloader/worker.py`, packaged as `MangaDownloaderWorker.exe`) and talks to it over newline-delimited JSON on stdin/stdout. Commands: `probe`, `add`, `cancel`, `pause`, `resume`, `ping`, `shutdown`. Full protocol, packaging and smoke-test details are in [downloader/README.md](downloader/README.md).

## Integrated Browser

- **Tabs** with drag/reorder, close, reload and history navigation
- **Bookmarks** with categories, rename, remove and a bookmark bubble
- **Search engines** switchable from Settings or the Extensions popover
- **Ad blocking** powered by Ghostery's engine with uBlock Origin, EasyList and Brave filter sets, per-site exceptions and refreshable lists
- **Browser proxy** — route only the browser through HTTP, HTTPS or SOCKS5; the reader stays on your normal connection
- **Force dark** on supported pages, with per-site opt-out
- **Built-in tools** — send the current page to the Downloader, scan every link on a page, open the page in your default browser
- **New Tab page**, downloads history and a Chrome-style Extensions popover for the built-in tools (not arbitrary Chrome Web Store extensions)

## Media Library & Player

- **Library** with recent, continue-playing and downloaded sections, custom folders and drag-and-drop import
- **Playback**: play/pause, seek preview, volume, speed control, keyboard shortcuts
- **Playlist** panel with sibling navigation and sorting
- **Resume** position per file, cleared automatically at the end
- **Theater mode**, picture-in-picture and fullscreen
- **Formats**: `.mp4`, `.webm`

## Library Management

- **Bookmarks** and **reading history** with page numbers
- **Search & filter** across large libraries
- **Multiple instances**: open more than one reading window
- **Themes**: built-in themes, custom CSS, Theme Maker, import/export and clipboard sharing
- **Keybindings**: fully customizable
- **Languages**: built-in locales plus installable community translation packs
- **Recently Deleted**: countdown retention, per-item retention and recovery
- **Backup & Restore**: library database, settings, presets, shortcuts, themes, covers and trash in one ZIP
- **Portable Mode**: run from a USB drive or external storage

## Supported Formats

### Images & Comics

| Kind | Extensions |
| --- | --- |
| Images | `.jpg`, `.jpeg`, `.png`, `.webp`, `.svg`, `.apng`, `.gif`, `.avif`, `.jxl` |
| Archives | `.zip`, `.cbz`, `.7z`, `.cb7`, `.rar`, `.cbr` |
| Documents | `.pdf` |

### Books & Video

| Kind | Extensions |
| --- | --- |
| Books | `.epub` |
| Video | `.mp4`, `.webm` |

> [!TIP]
> Image folders load fastest. Archives save space but are slightly slower. Keep paths under 260 characters on Windows.

## Installation

1. **Download** the latest build from [Releases](https://github.com/ivyiz/Yopomura/releases/latest)
2. **Choose your platform**:
   - Windows: `.exe` installer or `.zip` portable
   - Linux: `.deb` (Debian/Ubuntu) or `.zip`
3. **Install and launch**

## Beta Versions

Beta builds are published as "Pre-release" on the [Releases page](https://github.com/ivyiz/Yopomura/releases); the `beta` branch carries the latest development code.

- **Stable**: recommended for regular use
- **Beta**: newest features, may contain bugs

> [!WARNING]
> Beta builds may change the database schema without backward compatibility. Back up your profile before switching.

## Network Access & Privacy

Yopomura works fully offline for local reading, but some features are online by design:

- the **browser** loads whatever sites you open;
- the **downloader** fetches the pages and images from the URLs you submit;
- **AniList** sync and **update checks** contact their services;
- **ad-block lists** and optional recipe/extractor updates may be downloaded.

No account is required. Library contents, reading progress and downloads stay on your machine. See [PRIVACY.md](PRIVACY.md) for details.

## What It Doesn't Do

- **No content hosting**: Yopomura does not host, bundle or serve manga, comics, books or video. It only fetches URLs you provide.
- **No bundled media**: releases ship no library content; you bring files you own or are allowed to use.
- **No DRM circumvention**: it does not decrypt protected content or bypass paywalls/accounts.
- **No curated site catalog**: recipes and extractors are user-supplied or build-specific; site availability is not guaranteed.
- **No Chrome Web Store extensions**: the Extensions popover exposes Yopomura's built-in tools only.

You are responsible for the sites you visit, the URLs you download and the copyright rules that apply to you. See [DISCLAIMER.md](DISCLAIMER.md).

## Development

```bash
pnpm install
pnpm dev            # start Electron Forge
pnpm build:downloader  # rebuild the Python worker sidecar
pnpm test           # unit tests
pnpm test:e2e       # Playwright end-to-end tests
```

### Demo fixtures

For local UI and format testing, populate a **dev-only** demo library (public-domain EPUBs, open comic pages and generated fake chapters). It is not shipped with installs.

```powershell
pnpm demo:setup
```

Add the printed `demo/` path as a library location in Settings. Details: [Demo fixtures](docs/demo-fixtures.md).

### Quality checks

```bash
pnpm check          # Biome + TypeScript
pnpm check:content  # public-content guard
pnpm lint
```

## Documentation

- **[User Guide](docs/GUIDE.md)**: complete user manual and tips
- **[Downloader Recipes](docs/downloader-recipes.md)**: recipe schema, visual builder and script hooks
- **[Downloader Worker](downloader/README.md)**: JSON protocol, packaging and smoke tests
- **[Architecture](docs/architecture.md)**: process layout and data flow
- **[Build Guide](docs/build.md)**: development setup and compilation
- **[Contributing](docs/contribute.md)**: how to contribute
- **[Screenshots](docs/SCREENSHOTS.md)**: visual overview

## Support & Issues

- **Bug Reports / Feature Requests**: [GitHub Issues](https://github.com/ivyiz/Yopomura/issues)
- **Discussions**: [GitHub Discussions](https://github.com/ivyiz/Yopomura/discussions)
- **Security**: see [SECURITY.md](SECURITY.md)

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

Yopomura is a fork of [Yomikiru](https://github.com/mienaiyami/yomikiru) by mienaiyami, used under the MIT License. See [NOTICE](NOTICE) for attribution.

### Built With

- [Electron](https://www.electronjs.org/) — cross-platform desktop apps
- [React](https://reactjs.org/) — user interface
- [TypeScript](https://www.typescriptlang.org/) — type-safe JavaScript
- [Drizzle ORM](https://orm.drizzle.team/) — database access
- [Redux Toolkit](https://redux-toolkit.js.org/) — state management
- [Ghostery Adblocker](https://github.com/ghostery/adblocker) — browser ad blocking

---

<div align="center">

**[Download Now](https://github.com/ivyiz/Yopomura/releases/latest)** • **[Documentation](docs/GUIDE.md)** • **[Screenshots](docs/SCREENSHOTS.md)**

</div>
