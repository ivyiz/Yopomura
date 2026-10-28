#!/usr/bin/env python3
"""Headless manga downloader worker.

Speaks newline-delimited JSON over stdin/stdout. One job runs at a time.
See README.md for the protocol.
"""

from __future__ import annotations

import importlib
import json
import os
import re
import shutil
import signal
import sys
import tempfile
import threading
import time
import unicodedata
import zipfile
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import requests

try:
    from gallery_dl import job as gdl_job
except ImportError:
    gdl_job = None


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
REQUEST_TIMEOUT = 25
DOWNLOAD_WORKERS = 6
RETRY_WORKERS = 3
MAX_RETRIES = 4
CHUNK_SIZE = 64 * 1024
PROGRESS_INTERVAL = 0.15
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"}

_thread_local = threading.local()


class JobCancelled(Exception):
    pass


class DownloadFailed(Exception):
    pass


def _new_http_session():
    return requests.Session()


def get_session():
    session = getattr(_thread_local, "session", None)
    if session is None:
        session = _new_http_session()
        _thread_local.session = session
    return session


def response_text(resp):
    content = resp.content
    encoding = (getattr(resp, "encoding", None) or "").lower()
    default_encodings = {"", "iso-8859-1", "latin-1", "ascii"}
    if encoding in default_encodings:
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            pass
    try:
        return content.decode(encoding or "utf-8", errors="replace")
    except LookupError:
        return content.decode("utf-8", errors="replace")


def fix_mojibake(text: str) -> str:
    if not text:
        return text
    markers = ("Ã", "Â", "á»", "áº", "â€", "à»", "àº")
    for _ in range(2):
        if not any(marker in text for marker in markers):
            break
        repaired = None
        for source_encoding in ("cp1252", "latin-1"):
            try:
                repaired = text.encode(source_encoding).decode("utf-8")
            except (UnicodeEncodeError, UnicodeDecodeError):
                continue
            break
        if repaired is None or repaired == text:
            break
        text = repaired
    return text


def sanitize_filename(name, fallback="download"):
    text = fix_mojibake(str(name or ""))
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    if not text:
        text = fallback
    if text.split(".")[0].upper() in {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    }:
        text = "_" + text
    text = text[:120].strip(" .")
    return text or fallback


def safe_child(base, name):
    base_abs = os.path.abspath(base)
    target = os.path.abspath(os.path.join(base_abs, name))
    try:
        common = os.path.commonpath([base_abs, target])
    except ValueError as exc:
        raise DownloadFailed(f"Invalid output path: {name}") from exc
    if os.path.normcase(common) != os.path.normcase(base_abs):
        raise DownloadFailed(f"Output path escapes destination: {name}")
    return target


def image_extension(url):
    ext = os.path.splitext(urlparse(url).path)[1].lower()
    if ext == ".jpeg":
        return ".jpeg"
    return ext if ext in IMAGE_EXTS else ".jpg"


def unlink(path):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError:
        pass


def wait_if_paused(paused: threading.Event, cancel: threading.Event):
    """Blocks while paused, without ever ignoring a cancellation request."""
    while paused.is_set():
        if cancel.is_set():
            raise JobCancelled
        if cancel.wait(0.05):
            raise JobCancelled


def download_image(url, dest, headers, cancel: threading.Event, paused: threading.Event | None = None):
    if cancel.is_set():
        raise JobCancelled
    if paused is not None:
        wait_if_paused(paused, cancel)
    part = dest + ".part"
    session = get_session()
    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        if cancel.is_set():
            raise JobCancelled
        if paused is not None:
            wait_if_paused(paused, cancel)
        retry_after = None
        try:
            resp = session.get(url, headers=headers, timeout=REQUEST_TIMEOUT, stream=True)
            try:
                status = resp.status_code
                if status != 200:
                    if 400 <= status < 500 and status != 429:
                        raise DownloadFailed(f"HTTP {status} for {url}")
                    retry_after = _retry_after_seconds(resp)
                    raise RuntimeError(f"HTTP {status}")
                expected = resp.headers.get("Content-Length")
                content_encoding = (resp.headers.get("Content-Encoding") or "identity").lower()
                if content_encoding not in ("", "identity"):
                    expected = None
                expected = int(expected) if expected and expected.isdigit() else None
                written = 0
                with open(part, "wb") as handle:
                    for chunk in resp.iter_content(CHUNK_SIZE):
                        if cancel.is_set():
                            raise JobCancelled
                        if paused is not None:
                            wait_if_paused(paused, cancel)
                        if chunk:
                            handle.write(chunk)
                            written += len(chunk)
                if written == 0:
                    raise RuntimeError("empty response body")
                if expected is not None and written != expected:
                    raise RuntimeError(f"truncated download ({written}/{expected} bytes)")
            finally:
                close = getattr(resp, "close", None)
                if close is not None:
                    close()
            os.replace(part, dest)
            return
        except JobCancelled:
            unlink(part)
            raise
        except DownloadFailed:
            unlink(part)
            raise
        except Exception as exc:
            unlink(part)
            last_error = exc
            if attempt >= MAX_RETRIES:
                break
            delay = min(10.0, 0.75 * (2 ** (attempt - 1)))
            if retry_after is not None:
                delay = min(30.0, retry_after)
            if cancel.wait(delay):
                raise JobCancelled
    raise DownloadFailed(f"{url}: {last_error}")


def _retry_after_seconds(resp):
    value = resp.headers.get("Retry-After")
    if value and value.isdigit():
        return max(0, int(value))
    return None


def _get(session, url, headers, **kwargs):
    kwargs.setdefault("timeout", 15)
    return session.get(url, headers=headers, **kwargs)


class _PageImageCollector(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.urls = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "img":
            for key in ("data-src", "data-original", "data-lazy-src", "src"):
                value = values.get(key)
                if value:
                    self.urls.append(value)
                    break
            srcset = values.get("srcset")
            if srcset:
                candidate = srcset.split(",")[0].strip().split(" ")[0]
                if candidate:
                    self.urls.append(candidate)
        elif tag == "source":
            srcset = values.get("srcset")
            if srcset:
                candidate = srcset.split(",")[0].strip().split(" ")[0]
                if candidate:
                    self.urls.append(candidate)
        elif tag == "a":
            href = values.get("href")
            if href and os.path.splitext(urlparse(href).path)[1].lower() in IMAGE_EXTS:
                self.urls.append(href)


def _page_title(html, fallback):
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if not match:
        return sanitize_filename(fallback)
    title = re.sub(r"<[^>]+>", "", match.group(1))
    return sanitize_filename(title or fallback)


def extract_generic_page(target_url):
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,image/*,*/*;q=0.8",
    }
    session = _new_http_session()
    response = _get(session, target_url, headers)
    if response.status_code != 200:
        raise DownloadFailed(f"HTTP {response.status_code} for {target_url}")

    content_type = (response.headers.get("Content-Type") or "").lower()
    path_extension = os.path.splitext(urlparse(target_url).path)[1].lower()
    if content_type.startswith("image/") or path_extension in IMAGE_EXTS:
        name = os.path.splitext(os.path.basename(urlparse(target_url).path))[0]
        return sanitize_filename(name or "image"), [target_url], headers

    html = response_text(response)
    collector = _PageImageCollector()
    collector.feed(html)
    urls = []
    seen = set()
    for raw in collector.urls:
        absolute = urljoin(target_url, raw.strip())
        if not absolute.lower().startswith(("http://", "https://")):
            continue
        extension = os.path.splitext(urlparse(absolute).path)[1].lower()
        if extension and extension not in IMAGE_EXTS:
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        urls.append(absolute)
    if not urls:
        raise DownloadFailed("No downloadable images found on this page")
    fallback = os.path.basename(urlparse(target_url).path) or "download"
    return _page_title(html, fallback), urls, headers

def extract_gallery_dl(target_url):
    if gdl_job is None:
        raise DownloadFailed("gallery-dl is not installed")
    job = gdl_job.DataJob(target_url, file=None)
    job.run()
    if not job.data_urls:
        raise DownloadFailed("gallery-dl found no images")
    title = None
    if job.data_post:
        for post in job.data_post:
            if post.get("title"):
                title = sanitize_filename(post["title"])
                break
    if not title:
        path = urlparse(target_url).path.strip("/").replace("/", "_")
        title = sanitize_filename(path or "downloaded_manga")
    if hasattr(job.extractor, "session"):
        headers = dict(job.extractor.session.headers)
    else:
        headers = {"User-Agent": USER_AGENT}
    return title, job.data_urls, headers


def extract_manga_info(target_url):
    """Use gallery-dl when available, then fall back to generic page images."""
    if gdl_job is not None:
        try:
            return extract_gallery_dl(target_url)
        except Exception:
            pass
    return extract_generic_page(target_url)


_patched_module = os.environ.get("YOPOMURA_DOWNLOADER_EXTRACTOR_MODULE") or os.environ.get(
    "YOMIKIRU_DOWNLOADER_EXTRACTOR_MODULE"
)
if _patched_module:
    try:
        extract_manga_info = importlib.import_module(_patched_module).extract_manga_info
    except Exception as exc:
        print(f"worker: cannot load extractor module {_patched_module}: {exc}", file=sys.stderr)
        raise SystemExit(2)


class Emitter:
    def __init__(self, stream):
        self._stream = stream
        self._lock = threading.Lock()

    def emit(self, event, **fields):
        payload = {"event": event}
        payload.update(fields)
        line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            try:
                self._stream.write(line + "\n")
                self._stream.flush()
            except (BrokenPipeError, OSError):
                pass


@dataclass
class Job:
    id: str
    url: str
    out_dir: str
    keep_folder: bool = False
    cancel: threading.Event = field(default_factory=threading.Event)
    title: str | None = None
    progress: int = 0
    downloaded: int = 0
    total: int = 0
    output_path: str | None = None
    status: str = "queued"


def job_fields(job: Job, status, message=None, error=None, progress=None, output_path=None):
    return {
        "id": job.id,
        "status": status,
        "title": job.title,
        "progress": job.progress if progress is None else progress,
        "downloaded": job.downloaded,
        "total": job.total,
        "outputPath": job.output_path if output_path is None else output_path,
        "message": message,
        "error": error,
    }


class ProgressReporter:
    def __init__(self, job, emit, paused: threading.Event):
        self.job = job
        self.emit = emit
        self._paused = paused
        self._lock = threading.Lock()
        self._last = 0.0
        self._published = None

    def advance(self, count=1, force=False):
        with self._lock:
            self.job.downloaded += count
            now = time.monotonic()
            if force or self.job.total == 0 or self.job.downloaded >= self.job.total or now - self._last >= PROGRESS_INTERVAL:
                self._last = now
                self._publish()

    def set_paused(self, paused):
        """Emits the paused/downloading transition under the progress lock.

        Serializing with {@link advance} guarantees a paused event is never
        followed by a stale downloading progress event.
        """
        with self._lock:
            self._publish(force=True, message="Paused" if paused else "Resumed")

    def announce(self, message):
        """First `downloading` event of the job, ordered against pause()."""
        with self._lock:
            self._publish(force=True, message=message)

    def _publish(self, force=False, message=None):
        snapshot = (self.job.downloaded, self.job.total)
        if snapshot == self._published and not force:
            return
        self._published = snapshot
        total = self.job.total
        percent = 100 if total and self.job.downloaded >= total else int(self.job.downloaded * 100 / total) if total else 0
        self.job.progress = max(0, min(100, percent))
        status = "paused" if self._paused.is_set() else "downloading"
        self.job.status = status
        self.emit("job", **job_fields(self.job, status, message="Paused" if status == "paused" else message))


class Downloader:
    def __init__(self, emit):
        self.emit = emit
        self._cond = threading.Condition()
        self._queue: deque[Job] = deque()
        self._jobs: dict[str, Job] = {}
        self._active: Job | None = None
        self._reporter: ProgressReporter | None = None
        self._paused = threading.Event()
        self._stopping = False
        self._thread = threading.Thread(target=self._runner, name="job-runner", daemon=True)

    def start(self):
        self._thread.start()

    def is_paused(self):
        return self._paused.is_set()

    def pause(self):
        with self._cond:
            if self._paused.is_set():
                return
            self._paused.set()
            self._cond.notify_all()
            job = self._active
            reporter = self._reporter
        if job is None:
            self._log(None, "info", "Downloads paused")
            return
        if reporter is not None:
            reporter.set_paused(True)
        else:
            job.status = "paused"
            self.emit("job", **job_fields(job, "paused", message="Paused"))
        self._log(job.id, "info", "Paused")

    def resume(self):
        with self._cond:
            if not self._paused.is_set():
                return
            self._paused.clear()
            self._cond.notify_all()
            job = self._active
            reporter = self._reporter
        if job is None:
            self._log(None, "info", "Downloads resumed")
            return
        if reporter is not None:
            reporter.set_paused(False)
        else:
            job.status = "downloading"
            self.emit("job", **job_fields(job, "downloading", message="Resumed"))
        self._log(job.id, "info", "Resumed")

    def add(self, job_id, url, out_dir, keep_folder=False):
        if not isinstance(job_id, str) or not job_id.strip():
            self._log(None, "error", "add: missing or invalid job id")
            return
        if not isinstance(url, str) or urlparse(url).scheme not in ("http", "https"):
            self._reject(job_id, "add: url must start with http:// or https://")
            return
        if not isinstance(out_dir, str) or not out_dir.strip():
            self._reject(job_id, "add: missing outDir")
            return
        out_dir = os.path.abspath(os.path.expanduser(out_dir))
        job = Job(id=job_id, url=url.strip(), out_dir=out_dir, keep_folder=bool(keep_folder))
        with self._cond:
            if job_id in self._jobs:
                duplicate = True
            else:
                duplicate = False
                self._jobs[job_id] = job
                self._queue.append(job)
                self._cond.notify()
        if duplicate:
            self._log(job_id, "error", "add: duplicate job id")
            return
        self._log(job_id, "info", f"Queued {job.url}")

    def cancel(self, job_id):
        removed = False
        with self._cond:
            job = self._jobs.get(job_id)
            if job is not None:
                job.cancel.set()
                try:
                    self._queue.remove(job)
                    removed = True
                    job.status = "cancelled"
                except ValueError:
                    removed = False
        if job is None:
            self._log(job_id, "warn", "cancel: unknown job id")
            return
        if removed:
            self._terminal(job, "cancelled", message="Cancelled before start")

    def stop(self):
        with self._cond:
            self._stopping = True
            if self._active is not None:
                self._active.cancel.set()
            pending = list(self._queue)
            self._queue.clear()
            self._cond.notify_all()
        for job in pending:
            job.cancel.set()
            self._terminal(job, "cancelled", message="Cancelled before start")

    def wait(self, timeout):
        self._thread.join(timeout)
        return not self._thread.is_alive()

    def status(self):
        with self._cond:
            return (self._active.id if self._active else None, len(self._queue))

    def _reject(self, job_id, message):
        job = Job(id=job_id, url="", out_dir="")
        self.emit("job", **job_fields(job, "error", message=message, error=message))
        self._log(job_id, "error", message)

    def _log(self, job_id, level, message):
        self.emit("log", id=job_id, level=level, message=message)

    def _terminal(self, job, status, message=None, error=None):
        with self._cond:
            job.status = status
            self._jobs.pop(job.id, None)
        self.emit("job", **job_fields(job, status, message=message, error=error))

    def _check_cancel(self, job):
        if job.cancel.is_set():
            raise JobCancelled

    def _runner(self):
        while True:
            with self._cond:
                while not self._stopping and (not self._queue or self._paused.is_set()):
                    self._cond.wait()
                if self._stopping:
                    return
                job = self._queue.popleft()
                self._active = job
            try:
                self._check_cancel(job)
                self._run(job)
            except JobCancelled:
                self._log(job.id, "info", "Job cancelled")
                self._terminal(job, "cancelled", message="Cancelled")
            except (Exception, SystemExit) as exc:
                self._log(job.id, "error", f"Job failed: {exc}")
                self._terminal(job, "error", message="Download failed", error=str(exc))
            finally:
                with self._cond:
                    if self._active is job:
                        self._active = None
                    self._reporter = None

    def _hold_while_paused(self, job):
        wait_if_paused(self._paused, job.cancel)
        self._check_cancel(job)

    def _run(self, job):
        job.status = "resolving"
        self.emit("job", **job_fields(job, "resolving", message="Resolving gallery"))
        self._log(job.id, "info", f"Resolving {job.url}")

        title, urls, headers = extract_manga_info(job.url)
        self._check_cancel(job)

        urls = [
            url for url in urls
            if isinstance(url, str) and url.lower().startswith(("http://", "https://"))
        ]
        if not urls:
            raise DownloadFailed("No downloadable images found")
        headers = dict(headers or {})
        headers.setdefault("User-Agent", USER_AGENT)

        # Do not start the download phase (and waste the temporary folder)
        # while the worker is paused.
        self._hold_while_paused(job)

        job.title = sanitize_filename(title or "download")
        job.total = len(urls)
        job.progress = 0
        os.makedirs(job.out_dir, exist_ok=True)
        if not os.path.isdir(job.out_dir):
            raise DownloadFailed(f"Output directory is not usable: {job.out_dir}")

        job.status = "downloading"
        self._log(job.id, "info", f"Found {job.total} image(s): {job.title}")

        temp_dir = tempfile.mkdtemp(prefix=f"_temp_{job.title[:48]}_", dir=job.out_dir)
        zip_path = safe_child(job.out_dir, f"{job.title}.zip")
        zip_part = zip_path + ".part"
        keep_temp = False
        reporter = ProgressReporter(job, self.emit, self._paused)
        self._reporter = reporter
        try:
            reporter.announce(f"0/{job.total} images")
            completed = self._download_all(job, urls, headers, temp_dir, reporter)
            self._reporter = None
            if not completed:
                raise DownloadFailed("All image downloads failed")
            if len(completed) < job.total:
                self._log(job.id, "warn", f"{job.total - len(completed)} image(s) could not be downloaded")

            self._check_cancel(job)
            job.status = "packing"
            self.emit("job", **job_fields(job, "packing", message="Packing ZIP"))
            self._log(job.id, "info", f"Packing {len(completed)} image(s)")

            with zipfile.ZipFile(zip_part, "w", zipfile.ZIP_DEFLATED) as archive:
                for path in completed:
                    self._check_cancel(job)
                    archive.write(path, arcname=os.path.basename(path))
            os.replace(zip_part, zip_path)

            if job.keep_folder:
                folder_path = safe_child(job.out_dir, job.title)
                if os.path.isdir(folder_path):
                    shutil.rmtree(folder_path)
                elif os.path.exists(folder_path):
                    raise DownloadFailed(f"Cannot keep image folder; file exists: {folder_path}")
                os.replace(temp_dir, folder_path)
                keep_temp = True
                message = "Saved ZIP and image folder"
            else:
                shutil.rmtree(temp_dir, ignore_errors=True)
                keep_temp = True
                message = "Saved ZIP"

            job.output_path = zip_path
            job.downloaded = len(completed)
            job.progress = 100
            self._log(job.id, "info", f"Saved {zip_path}")
            self._terminal(job, "done", message=message)
        except BaseException:
            self._reporter = None
            if not keep_temp:
                shutil.rmtree(temp_dir, ignore_errors=True)
            unlink(zip_part)
            raise

    def _download_all(self, job, urls, headers, temp_dir, reporter):
        pad = max(3, len(str(len(urls))))
        tasks = []
        for index, url in enumerate(urls, 1):
            dest = os.path.join(temp_dir, f"{index:0{pad}d}{image_extension(url)}")
            tasks.append((index, url, dest))

        def work(task):
            index, url, dest = task
            wait_if_paused(self._paused, job.cancel)
            self._check_cancel(job)
            download_image(url, dest, headers, job.cancel, self._paused)
            reporter.advance()

        def run_pass(batch, workers):
            failures = []
            executor = ThreadPoolExecutor(max_workers=max(1, min(workers, len(batch))))
            future_map = {executor.submit(work, task): task for task in batch}
            try:
                for future in as_completed(future_map):
                    if job.cancel.is_set():
                        raise JobCancelled
                    task = future_map[future]
                    try:
                        future.result()
                    except JobCancelled:
                        raise
                    except Exception as exc:
                        failures.append(task)
                        self._log(job.id, "warn", f"Image {task[0]} failed: {exc}")
            finally:
                for future in future_map:
                    future.cancel()
                executor.shutdown(wait=True, cancel_futures=True)
            return failures

        failures = run_pass(tasks, DOWNLOAD_WORKERS)
        reporter.advance(0, force=True)
        if failures:
            self._log(job.id, "warn", f"Retrying {len(failures)} image(s)")
            if job.cancel.wait(1.5):
                raise JobCancelled
            failures = run_pass(failures, RETRY_WORKERS)
            reporter.advance(0, force=True)
        if failures:
            self._log(job.id, "warn", f"{len(failures)} image(s) still missing")

        return [
            task[2] for task in tasks
            if os.path.isfile(task[2]) and os.path.getsize(task[2]) > 0
        ]


def configure_stdio():
    for stream in (sys.stdin, sys.stdout):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace", newline="\n")
        except (AttributeError, ValueError):
            pass


def main():
    configure_stdio()
    emit = Emitter(sys.stdout).emit
    downloader = Downloader(emit)
    downloader.start()
    emit("ready")

    def request_stop(signum, frame):
        raise SystemExit(0)

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, request_stop)
        except (OSError, ValueError):
            pass

    try:
        while True:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if line.startswith("\ufeff"):
                line = line.lstrip("\ufeff")
            if not line:
                continue
            try:
                message = json.loads(line)
            except ValueError as exc:
                emit("log", id=None, level="error", message=f"Invalid JSON: {exc}")
                continue
            if not isinstance(message, dict):
                emit("log", id=None, level="error", message="Command must be a JSON object")
                continue

            cmd = message.get("cmd")
            if cmd == "add":
                downloader.add(
                    message.get("id"),
                    message.get("url"),
                    message.get("outDir"),
                    bool(message.get("keepFolder", False)),
                )
            elif cmd == "cancel":
                downloader.cancel(message.get("id"))
            elif cmd == "pause":
                downloader.pause()
            elif cmd == "resume":
                downloader.resume()
            elif cmd == "ping":
                active, queued = downloader.status()
                emit("pong", id=message.get("id"), active=active, queued=queued, paused=downloader.is_paused())
            elif cmd == "shutdown":
                break
            else:
                emit("log", id=message.get("id"), level="error", message=f"Unknown command: {cmd!r}")
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        downloader.stop()
        if not downloader.wait(5.0):
            try:
                sys.stdout.flush()
            except Exception:
                pass
            os._exit(0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
