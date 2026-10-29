# Downloader recipes

Recipes let Yopomura adapt to a manga/comic site without rebuilding the app.
They are declarative JSON files. Sites that cannot be described declaratively
may opt into a page-context script hook.

## Where recipes live

- User recipes: `userData/downloader-recipes/*.json`
- Import a recipe from the Downloader → Sites tab → **Import Recipe**.
- **Open Folder** opens the active recipe directory.
- **Create downloader recipe** in the browser page context menu starts a visual picker: choose chapter/gallery mode, click a chapter link, click a page image, and optionally a next-page button.
- The resulting draft opens in Downloader → Sites → **Recipe Editor** for review, preview and saving.

The public app ships no site-specific adult recipes. Private recipe packs can be
kept outside the repository and imported into the user profile.

## Recipe shape

```json
{
  "schemaVersion": 1,
  "id": "example-site",
  "name": "Example Site",
  "enabled": true,
  "match": ["example.com", "*.example.com"],
  "mode": "series",
  "title": { "selector": "h1.title", "attribute": "text" },
  "waitFor": ".chapter-list",
  "chapters": {
    "selector": ".chapter-list a",
    "linkAttribute": "href",
    "nameAttribute": "text",
    "limit": 300
  },
  "pages": {
    "selector": ".reader img",
    "attributes": ["data-src", "src", "srcset"]
  },
  "next": { "selector": "a.next-page", "attribute": "href" },
  "exclude": ["logo", "avatar", "/ads?/"]
}
```

## Fields

| Field | Meaning |
| --- | --- |
| `match` | Hosts, `*.host` wildcards, or `/regex/` patterns. |
| `mode` | `series`, `reader`, `gallery`, or `auto`. |
| `title` | Selector and attribute for the title. `text` reads text content. |
| `waitFor` | Optional selector to wait for after navigation. |
| `chapters` | Chapter links on a series page. `limit` caps the list. |
| `pages` | Image elements on a reader/gallery page. Attributes are tried in order. |
| `next` | Optional next-page selector inside the same chapter/gallery. |
| `exclude` | URL substrings or `/regex/` patterns to remove from the page list. |
| `script` | Optional page-context script hook. Replaces or supplements `pages`. |

`srcset` chooses the largest candidate. For `<img>` elements, `src` prefers the
current rendered source. A recipe with no `chapters` runs in gallery/reader mode.

## Script hooks

A recipe may replace `pages`, or refine the result, with a `script` field. The
script runs inside the sandboxed recipe browser page (no Node integration, no
filesystem access) and must evaluate to an async function that returns either
`images`, or `chapters` plus `images`, or both, optionally with `title` and
`next`.

```json
{
  "id": "canvas-reader",
  "name": "Canvas Reader",
  "match": ["canvas.example"],
  "mode": "reader",
  "waitFor": ".reader canvas",
  "script": "async () => ({ images: [...document.querySelectorAll('.reader img')].map(img => img.src) })"
}
```

Returned shape:

| Field | Meaning |
| --- | --- |
| `title` | Optional page/series title. |
| `chapters` | Optional chapter links: strings or `{ href, name }`. |
| `images` | Image URLs: strings or `{ url, width, height }`. |
| `next` | Optional next-page URL. |

Only use script recipes you trust: a script runs with the same permissions as
the page it is loaded in. Script recipes are opt-in and never shipped with the
public app.

## Testing

Use the Downloader → Sites → **Test URL** box. A preview shows the detected
title, mode, chapter count, image count, resolver source and sample image URLs
before a job is queued. Resolution tries a matching recipe first, then the
legacy gallery-dl/private extractor probe, then the generic Chromium resolver.
