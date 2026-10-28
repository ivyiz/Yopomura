# Privacy Policy

**Last updated:** August 31, 2026

Yopomura is a desktop reader with an optional media library, integrated browser, generic downloader, trash and profile backup. This policy describes what data the app handles on your device and when it contacts third-party services. Yopomura does not run its own servers and does not sell personal data.

## Summary

- Your library, reading progress, bookmarks, notes, covers, browser bookmarks, downloads and settings stay on your computer unless you choose to use an optional online feature.
- There is no Yopomura account, no in-app analytics, and no automatic crash or telemetry upload to the developer.
- Network use is limited to the browser/downloader requests you initiate, update checks you can turn off, and optional services such as AniList.

## Data stored on your device

Yopomura keeps application data in Electron `userData` (or next to the executable in portable mode). This includes:

| Data | Purpose |
| ------ | --------- |
| `data.db` (SQLite) | Library catalogue, reading progress, bookmarks, notes, tags, metadata overlays, and tracker links |
| `settings.json`, `main-settings.json` | Reader, gallery, and app preferences |
| `themes.json`, `reader-presets.json`, `shortcuts.json` | Custom themes, reader presets, and keyboard shortcuts |
| `covers/` | Library thumbnails and cached AniList tracker cover images (`tracker-<id>.webp`) |
| `backups/` | Optional automatic or manual database snapshots |
| `logs/` | Local diagnostic logs (`main.log`, `renderer.log`, `errors.log`) |
| `i18n-packs/` | Optional language packs you install from a `.zip` archive |
| `browser-bookmarks.json` | Browser bookmarks you save |
| `network-proxy.json` | Browser proxy settings; the password is encrypted with Electron `safeStorage` when available |
| Chromium browser profile | Cookies, cache, local storage and session data for the integrated browser partition |
| Downloads | Files you explicitly download; Yopomura does not upload them |

The app also reads files and folders you add to your library (manga folders, archives, EPUBs, PDFs). Those files are not uploaded to Yopomura.

### AniList token (optional)

If you log in to AniList, your OAuth access token is stored in the renderer's `localStorage` (`anilist_token`). It is kept out of `data.db` on purpose so database backups do not contain your token. Tracker rows and cached media snapshots live in SQLite instead.

### Integrated browser

The browser uses its own Chromium session partition. Pages you visit can set cookies, use local storage and cache data in that partition. Bookmarks are stored in `browser-bookmarks.json`. The New Tab page uses neutral default sites and may request favicons from those sites; no browsing history is uploaded to Yopomura.

### Generic downloader

When you start a download, the Python worker contacts the URL you supplied and follows the site's response. Downloaded files stay on your disk. The public build has no site-specific extractors; optional `gallery-dl` support runs locally if installed.

### Browser proxy

If you configure a manual proxy, only the integrated browser session uses it. The proxy host, port, username and bypass rules are stored locally; the password is encrypted with Electron `safeStorage` when available. Proxy credentials are not written to logs. The downloader worker can receive HTTP/HTTPS proxy environment variables when it starts.

## What Yopomura does not collect

- No account registration with the Yopomura project
- No usage analytics, advertising identifiers, or behavioral tracking
- No automatic upload of crash dumps or error logs to the developer or any third party

Errors are written to local log files only. Reporting a bug opens GitHub in your browser with pre-filled technical details (app version, platform, error JSON). That dialog states that no personal data is included; you choose whether to submit the issue.

## Optional network features

### Update checks (on by default)

When **Check for updates every 1 hour** is enabled (Settings → About), the app contacts GitHub to:

- List releases (`api.github.com/repos/yopomura/yopomura/releases`)
- Fetch `announcements.txt` from the repository
- Download release artifacts when **Auto download updates** is enabled

GitHub may log your IP address and request metadata under [GitHub's privacy policy](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement). You can disable hourly checks in Settings → About.

### AniList integration (opt in)

AniList is entirely optional. If you log in:

- The app calls [AniList's GraphQL API](https://graphql.anilist.co) to validate your token, search media, read and update your list entries, and sync progress when you enable auto-update.
- Search queries, list status, scores, progress, and related metadata are sent to AniList as part of normal API use.
- Cover image URLs from AniList may be downloaded once and saved under `userData/covers/` for offline display.

AniList's handling of your data is governed by [AniList's terms and privacy policies](https://anilist.co/terms). To stop sending data to AniList, log out (clear your token) or remove the integration from Settings.

### Links you open

Buttons and in-app links (AniList pages, GitHub, release notes, EPUB external URLs) open in your default browser. Yopomura does not proxy or record those visits. The integrated browser is separate: pages you load there use the browser partition described above.

### Language packs

Installing a language pack copies files from a `.zip` archive you select on disk into `userData/i18n-packs/`. The app does not download translation packs from the internet unless you obtain the archive elsewhere and install it yourself.

## Data retention and deletion

- Uninstalling Yopomura does not automatically delete `userData`; remove that folder manually if you want to erase all app data.
- Portable builds store data beside the app; delete that folder to remove local state.
- Clearing the cover cache (Settings) removes generated thumbnails under `covers/`.
- Database restore or import replaces `data.db` according to your chosen backup file.

## Children

Yopomura is a general-purpose desktop application and is not directed at children under 13. The project does not knowingly collect personal information from children.

## Changes to this policy

Updates to this document are published in the [Yopomura repository](https://github.com/yopomura/yopomura). The **Last updated** date at the top will change when the policy changes materially.

## Contact

Questions about this policy: open a [GitHub issue](https://github.com/yopomura/yopomura/issues).
