# Yopomura Downloader Worker

Headless Python downloader used by Yopomura. It has no GUI, no Tkinter and no
ctypes. The Electron app spawns `worker.py`, writes one JSON command per line to
its stdin and reads one JSON event per line from its stdout.

The public worker is generic: it downloads direct image/archive URLs and images
found on ordinary HTML pages, with an optional `gallery-dl` fallback. It does
not ship site-specific extractors. Private builds can provide an extractor
module through `YOPOMURA_DOWNLOADER_EXTRACTOR_MODULE` or a Python file through
`YOPOMURA_DOWNLOADER_EXTRACTOR_PATH`.

## Requirements

- Python 3.10+ (tested on 3.14)
- `requests` (required)
- `gallery-dl` (optional, generic fallback for supported sites)

```bash
pip install -r downloader/requirements.txt
```

`gallery-dl` is optional at runtime. Without it, the worker still handles direct
images and generic HTML pages.

## Protocol

Transport is newline-delimited JSON in both directions. Every line is exactly
one UTF-8 JSON object. The worker flushes stdout after every event.

### Commands (stdin)

```json
{"cmd":"probe","url":"https://example.com/gallery","token":"probe-1"}
{"cmd":"add","id":"job-1","url":"https://example.com/gallery","outDir":"C:\\Users\\me\\Downloads","keepFolder":false}
{"cmd":"cancel","id":"job-1"}
{"cmd":"pause"}
{"cmd":"resume"}
{"cmd":"ping"}
{"cmd":"shutdown"}
```

| Command | Fields | Description |
| --- | --- | --- |
| `probe` | `url`, `token` | Extract a gallery without downloading. Answers with one `probe` event for the same token. Only one probe runs at a time; a second request gets `busy: true`. |
| `add` | `id` (unique string), `url`, `outDir`, `keepFolder` (bool, optional) | Queue a download. `outDir` is created if needed. Allowed while paused: the job is queued, not started. |
| `cancel` | `id` | Cancel a queued or active job, including a paused one. Unknown ids produce a warning log. |
| `pause` | - | Pause the active job and hold the queue. Idempotent. |
| `resume` | - | Resume a paused worker and continue the queue. Idempotent. |
| `ping` | `id` (optional) | Liveness check; answered with a `pong` event. |
| `shutdown` | - | Cancel everything and exit, also while paused. Also happens on stdin EOF. |

Jobs run one at a time, FIFO. Adding several jobs queues them; only one is
`downloading` at any moment.

### Events (stdout)

```json
{"event":"ready"}
{"event":"job","id":"job-1","status":"resolving","title":null,"progress":0,"downloaded":0,"total":0,"outputPath":null,"message":"Resolving gallery","error":null}
{"event":"job","id":"job-1","status":"downloading","title":"Some Title","progress":33,"downloaded":1,"total":3,"outputPath":null,"message":null,"error":null}
{"event":"job","id":"job-1","status":"paused","title":"Some Title","progress":33,"downloaded":1,"total":3,"outputPath":null,"message":"Paused","error":null}
{"event":"job","id":"job-1","status":"packing","title":"Some Title","progress":100,"downloaded":3,"total":3,"outputPath":null,"message":"Packing ZIP","error":null}
{"event":"job","id":"job-1","status":"done","title":"Some Title","progress":100,"downloaded":3,"total":3,"outputPath":"C:\\Users\\me\\Downloads\\Some Title.zip","message":"Saved ZIP","error":null}
{"event":"log","id":"job-1","level":"info","message":"Found 3 image(s): Some Title"}
{"event":"probe","token":"probe-1","ok":true,"title":"Some Title","items":[{"url":"https://example.com/1.jpg","referer":null}],"headers":{"User-Agent":"..."},"elapsedMs":850}
{"event":"pong","id":null,"active":null,"queued":0,"paused":false}
```

`ready` is the first line emitted, before any command is processed. Then the
worker only reacts to stdin.

Every `job` event contains the same keys:

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | string | Job id from `add`. |
| `status` | string | `resolving`, `downloading`, `paused`, `packing`, `done`, `error` or `cancelled`. |
| `title` | string \| null | Sanitized gallery title; null until resolution succeeds. |
| `progress` | int 0-100 | Monotonic per job. 100 when `done`. |
| `downloaded` | int | Images successfully written so far. |
| `total` | int | Images discovered by the extractor (0 until resolved). |
| `outputPath` | string \| null | Absolute ZIP path when `done`, otherwise null. |
| `message` | string \| null | Human-readable status detail. |
| `error` | string \| null | Error detail for `error` events. |

Terminal statuses are `done`, `error` and `cancelled`; exactly one is emitted per
job, including across any number of pause/resume cycles. `paused` is not
terminal: it always carries the progress reached so far and is followed by
`downloading` on resume. A `log` event has `id` (string or null), `level`
(`info`, `warn`, `error`) and `message`. Logs are informational and must not be
treated as terminal events.

`pong` fields: `id` (echo of the ping id, or null), `active` (active job id or
null), `queued` (number of waiting jobs), `paused` (worker pause flag).

## Behaviour

- A job resolves in this order: matching recipe, legacy extractor probe
  (`probe`, 6 s default), then the Chromium browser resolver. A host that
  needed the browser resolver is remembered for 7 days so later jobs skip the
  probe. Successful resolutions are reused for 60 s so preview → queue does not
  analyze the same URL twice. Set `YOPOMURA_DOWNLOADER_LEGACY_FIRST=0` to
  disable legacy-first.
- By default a resolved job opens an image review with every image selected.
  Uncheck unwanted images and confirm before any download starts. Set
  `YOPOMURA_DOWNLOADER_REVIEW=0` to download immediately.
- Obvious video URLs are skipped by `probe`, `add` and `addResolved`, so a
  manga job never writes `.mp4`/`.webm` files into its output folder.
- Images are streamed with `requests` using `iter_content` and
  written to `<file>.part` before an atomic `os.replace`.
- `pause` stops new images from starting, holds the queue (no next job begins)
  and blocks inside the streaming loop between chunks, so in-flight images stop
  at the next chunk instead of being discarded. `resume` continues from the
  `.part` files. Pause latency for an image whose server has stalled is bounded
  by the 25 s request timeout.
- Each image is retried up to 4 times with exponential backoff; `429`
  `Retry-After` is honoured. A failed first pass is retried once more with
  reduced concurrency.
- Cancellation is checked before requests, while streaming and between ZIP
  entries, and it still works while paused. Cancelling during an extractor
  network call takes effect when that call returns or times out.
- Images are named `001.jpg`, `002.png`, ... using zero padding and the
  extension from the source URL.
- The ZIP is written with `ZIP_DEFLATED` to `<title>.zip.part` and atomically
  renamed to `<outDir>/<sanitized title>.zip`. An existing ZIP is replaced.
- `keepFolder: false` removes the temporary image directory after packing.
  `keepFolder: true` renames it to `<outDir>/<sanitized title>/` (replacing an
  existing folder of the same name).
- Temporary files and folders are removed on cancel and error.
- All output stays inside `outDir`: titles are stripped of Windows-invalid
  characters, reserved device names are prefixed, and every output path is
  checked with `commonpath`.
- Text is decoded as UTF-8 (instead of requests' latin-1 default) and filenames
  are normalized to NFC, with a guarded repair for common UTF-8/latin-1
  mojibake.

## Packaging the Windows sidecar

Electron packages `resources/downloader/MangaDownloaderWorker.exe`, so build the
one-file executable before `pnpm package`:

```bash
python -m PyInstaller --onefile --console --name MangaDownloaderWorker ^
  --distpath downloader --workpath build/downloader-worker ^
  --specpath build/downloader-worker ^
  --collect-all gallery_dl downloader/worker.py
```

Verify the packaged binary answers the protocol:

```powershell
'{"cmd":"ping"}' | .\downloader\MangaDownloaderWorker.exe
# {"event":"ready"}
# {"event":"pong",...}
```

In development the app spawns `python downloader/worker.py` instead; set
`YOKO_PYTHON` to choose a different interpreter.

## Testing

From the repository root:

```bash
python -m py_compile downloader/worker.py downloader/smoke_test.py
python downloader/smoke_test.py
```

The smoke test starts a local HTTP server on `127.0.0.1` serving three
generated PNGs, loads a fake extractor, and drives the real worker through a
subprocess. It covers a normal ZIP download, `keepFolder: true`, pause/resume
(including a queue held while paused and cancel while paused), cancellation,
extractor failure and shutdown while paused. It never contacts a real website.
Expected output:

```text
PASS job-main: ZIP downloaded, packed and verified
PASS job-keep: keepFolder preserved the image folder
PASS job-pause: pause stopped streaming, resume finished the job
PASS job-queued: queue stayed held while paused, then ran after resume
PASS job-pause-cancel: cancel works while paused
PASS job-cancel: cancellation produced a cancelled terminal event
PASS job-error: extractor failure produced an error event
PASS shutdown: worker exits cleanly while paused
PASS protocol: ... worker events were valid JSON lines
PASS terminal: one terminal event for each of 7 jobs
SMOKE TEST PASSED
```

### Manual test

```python
import json, subprocess, sys

proc = subprocess.Popen(
    [sys.executable, "-u", "downloader/worker.py"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
    text=True, encoding="utf-8",
)
proc.stdin.write(json.dumps({
    "cmd": "add", "id": "demo",
    "url": "https://example.com/gallery",
    "outDir": "C:\\Temp\\manga", "keepFolder": False,
}) + "\n")
proc.stdin.flush()
for line in proc.stdout:
    event = json.loads(line)
    print(event)
    if event.get("event") == "job" and event.get("status") in {"done", "error", "cancelled"}:
        break
proc.stdin.write('{"cmd":"shutdown"}\n')
proc.stdin.flush()
proc.wait()
```

### Custom extractor hook

For tests or private sites, set `YOPOMURA_DOWNLOADER_EXTRACTOR_MODULE` to an
importable module name, or `YOPOMURA_DOWNLOADER_EXTRACTOR_PATH` to a Python
file. Its `extract_manga_info(url)` must return `(title, [image_urls], headers)`
for supported sites, or `None` to fall back to gallery-dl/generic extraction.
The smoke test uses the module hook to avoid real network traffic. Stderr is
reserved for diagnostics and is never part of the protocol.
