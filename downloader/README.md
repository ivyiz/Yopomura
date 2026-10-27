# Yomikiru Downloader Worker

Headless Python downloader used by Yomikiru. It has no GUI, no Tkinter and no
ctypes. The Electron app spawns `worker.py`, writes one JSON command per line to
its stdin and reads one JSON event per line from its stdout.

Extractors are adapted from MangaDownloader Classic and currently support
hitomi.la, imhentai.xxx, nhentai.net, hentaivnx.com, vi-hentai.moe, a
gallery-dl fallback and a generic hentaivnx-style fallback.

## Requirements

- Python 3.10+ (tested on 3.14)
- `requests` (required)
- `curl_cffi` (optional, preferred: Chrome TLS impersonation)
- `gallery-dl` (optional, fallback extractor for unsupported sites)

```bash
pip install -r downloader/requirements.txt
```

`curl_cffi` and `gallery-dl` are optional at runtime. The worker falls back to
plain `requests` and to the built-in extractors when they are missing.

## Protocol

Transport is newline-delimited JSON in both directions. Every line is exactly
one UTF-8 JSON object. The worker flushes stdout after every event.

### Commands (stdin)

```json
{"cmd":"add","id":"job-1","url":"https://nhentai.net/g/123456","outDir":"C:\\Users\\me\\Downloads","keepFolder":false}
{"cmd":"cancel","id":"job-1"}
{"cmd":"ping"}
{"cmd":"shutdown"}
```

| Command | Fields | Description |
| --- | --- | --- |
| `add` | `id` (unique string), `url`, `outDir`, `keepFolder` (bool, optional) | Queue a download. `outDir` is created if needed. |
| `cancel` | `id` | Cancel a queued or active job. Unknown ids produce a warning log. |
| `ping` | `id` (optional) | Liveness check; answered with a `pong` event. |
| `shutdown` | - | Cancel everything and exit. Also happens on stdin EOF. |

Jobs run one at a time, FIFO. Adding several jobs queues them; only one is
`downloading` at any moment.

### Events (stdout)

```json
{"event":"ready"}
{"event":"job","id":"job-1","status":"resolving","title":null,"progress":0,"downloaded":0,"total":0,"outputPath":null,"message":"Resolving gallery","error":null}
{"event":"job","id":"job-1","status":"downloading","title":"Some Title","progress":33,"downloaded":1,"total":3,"outputPath":null,"message":null,"error":null}
{"event":"job","id":"job-1","status":"packing","title":"Some Title","progress":100,"downloaded":3,"total":3,"outputPath":null,"message":"Packing ZIP","error":null}
{"event":"job","id":"job-1","status":"done","title":"Some Title","progress":100,"downloaded":3,"total":3,"outputPath":"C:\\Users\\me\\Downloads\\Some Title.zip","message":"Saved ZIP","error":null}
{"event":"log","id":"job-1","level":"info","message":"Found 3 image(s): Some Title"}
{"event":"pong","id":null,"active":null,"queued":0}
```

`ready` is the first line emitted, before any command is processed. Then the
worker only reacts to stdin.

Every `job` event contains the same keys:

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | string | Job id from `add`. |
| `status` | string | `resolving`, `downloading`, `packing`, `done`, `error` or `cancelled`. |
| `title` | string \| null | Sanitized gallery title; null until resolution succeeds. |
| `progress` | int 0-100 | Monotonic per job. 100 when `done`. |
| `downloaded` | int | Images successfully written so far. |
| `total` | int | Images discovered by the extractor (0 until resolved). |
| `outputPath` | string \| null | Absolute ZIP path when `done`, otherwise null. |
| `message` | string \| null | Human-readable status detail. |
| `error` | string \| null | Error detail for `error` events. |

Terminal statuses are `done`, `error` and `cancelled`; exactly one is emitted per
job. A `log` event has `id` (string or null), `level` (`info`, `warn`, `error`)
and `message`. Logs are informational and must not be treated as terminal
events.

`pong` fields: `id` (echo of the ping id, or null), `active` (active job id or
null), `queued` (number of waiting jobs).

## Behaviour

- Images are streamed with `requests`/`curl_cffi` using `iter_content` and
  written to `<file>.part` before an atomic `os.replace`.
- Each image is retried up to 4 times with exponential backoff; `429`
  `Retry-After` is honoured. A failed first pass is retried once more with
  reduced concurrency.
- Cancellation is checked before requests, while streaming and between ZIP
  entries. Cancelling during an extractor network call takes effect when that
  call returns or times out.
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
  --collect-all curl_cffi --collect-all gallery_dl downloader/worker.py
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
subprocess. It covers a normal ZIP download, `keepFolder: true`, cancellation
and extractor failure. It never contacts a real website. Expected output:

```text
PASS job-main: ZIP downloaded, packed and verified
PASS job-keep: keepFolder preserved the image folder
PASS job-cancel: cancellation produced a cancelled terminal event
PASS job-error: extractor failure produced an error event
PASS protocol: ... worker events were valid JSON lines
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
    "url": "https://nhentai.net/g/123456",
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

For tests or private sites, set `YOMIKIRU_DOWNLOADER_EXTRACTOR_MODULE` to an
importable module name. Its `extract_manga_info(url)` must return
`(title, [image_urls], headers)`. The smoke test uses this hook to avoid real
network traffic. Stderr is reserved for diagnostics and is never part of the
protocol.
