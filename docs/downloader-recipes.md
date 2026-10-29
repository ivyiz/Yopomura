# Downloader recipes

Recipes let Yopomura adapt to a manga/comic site without rebuilding the app.
They are declarative JSON files and cannot run code.

## Where recipes live

- User recipes: `userData/downloader-recipes/*.json`
- Import a recipe from the Downloader → Sites tab → **Import Recipe**.
- **Open Folder** opens the active recipe directory.

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

`srcset` chooses the largest candidate. For `<img>` elements, `src` prefers the
current rendered source. A recipe with no `chapters` runs in gallery/reader mode.

## Testing

Use the Downloader → Sites → **Test URL** box. A preview shows the detected
title, mode, chapter count, image count and sample image URLs before a job is
queued. If a recipe finds no images, the generic Chromium resolver and then the
legacy gallery-dl/private extractors are used as fallbacks.
