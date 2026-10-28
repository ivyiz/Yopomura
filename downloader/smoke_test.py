#!/usr/bin/env python3
"""End-to-end smoke test for downloader/worker.py.

Starts a local HTTP server with three generated PNGs and a fake extractor,
then drives the worker over its JSON-lines protocol. No external network.
"""

from __future__ import annotations

import http.server
import json
import os
import queue
import random
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
import zlib
from collections import Counter
from functools import partial
from pathlib import Path

DOWNLOADER_DIR = Path(__file__).resolve().parent
REPO_ROOT = DOWNLOADER_DIR.parent
TERMINAL = {"done", "error", "cancelled"}
JOB_KEYS = {
    "event", "id", "status", "title", "progress",
    "downloaded", "total", "outputPath", "message", "error",
}

FAKE_EXTRACTOR = '''\
import os
import time
from urllib.parse import urlparse

BASE_URL = os.environ["SMOKE_BASE_URL"].rstrip("/")


def _images():
    return [f"{BASE_URL}/img/{index}.png" for index in (1, 2, 3)]


def _slow_images():
    return [f"{BASE_URL}/slowimg/{index}.png" for index in (1, 2, 3)]


def extract_manga_info(url):
    path = urlparse(url).path
    headers = {"User-Agent": "yopomura-smoke"}
    if path == "/boom":
        raise RuntimeError("fake extractor failure")
    if path == "/slow":
        time.sleep(2.0)
        return "Slow Manga", _images(), headers
    if path == "/keep":
        return "Smoke Manga Keep", _images(), headers
    if path == "/pausable":
        return "Smoke Manga Pause", _slow_images(), headers
    if path == "/queued":
        return "Smoke Manga Queued", _images(), headers
    return "Smoke Manga", _images(), headers
'''


def make_png(seed):
    width = height = 64
    rng = random.Random(seed)
    raw = bytearray()
    for _ in range(height):
        raw.append(0)
        raw.extend(rng.randbytes(width * 3))

    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


class SlowFileHandler(QuietHandler):
    """Serves `/slowimg/*` in small, throttled chunks.

    The pause test needs a download that is still streaming when the pause
    command arrives; normal files are served at full speed.
    """

    CHUNK_SIZE = 512
    CHUNK_DELAY = 0.03

    def copyfile(self, source, outputfile):
        if not self.path.startswith("/slowimg/"):
            return super().copyfile(source, outputfile)
        while True:
            chunk = source.read(self.CHUNK_SIZE)
            if not chunk:
                return
            outputfile.write(chunk)
            outputfile.flush()
            time.sleep(self.CHUNK_DELAY)


class LocalServer:
    def __init__(self, directory):
        handler = partial(SlowFileHandler, directory=str(directory))
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def base_url(self):
        host, port = self.httpd.server_address[:2]
        return f"http://{host}:{port}"

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc_info):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)


class WorkerProcess:
    def __init__(self, env):
        self.proc = subprocess.Popen(
            [sys.executable, "-u", str(DOWNLOADER_DIR / "worker.py")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            cwd=str(REPO_ROOT),
            env=env,
        )
        self.events = queue.Queue()
        self.seen = []
        self.protocol_errors = []
        self.stderr = []
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

    def _read_stdout(self):
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError as exc:
                self.protocol_errors.append((line, str(exc)))
                continue
            self.seen.append(event)
            self.events.put(event)
        self.events.put(None)

    def _read_stderr(self):
        for line in self.proc.stderr:
            self.stderr.append(line.rstrip())

    def send(self, command):
        self.proc.stdin.write(json.dumps(command, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

    def next_event(self, timeout):
        try:
            event = self.events.get(timeout=timeout)
        except queue.Empty:
            raise AssertionError(f"timed out waiting for worker event\nstderr:\n{self._stderr_text()}") from None
        if event is None:
            raise AssertionError(f"worker stdout closed\nstderr:\n{self._stderr_text()}")
        return event

    def wait_for(self, predicate, timeout, what):
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AssertionError(f"timed out waiting for {what}\nstderr:\n{self._stderr_text()}")
            event = self.next_event(remaining)
            if predicate(event):
                return event

    def drain(self, seconds):
        """Collects events for `seconds`; used to assert nothing happens."""
        events = []
        deadline = time.monotonic() + seconds
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return events
            try:
                event = self.events.get(timeout=remaining)
            except queue.Empty:
                return events
            if event is None:
                raise AssertionError(f"worker stdout closed\nstderr:\n{self._stderr_text()}")
            events.append(event)

    def _stderr_text(self):
        return "\n".join(self.stderr[-50:])

    def close(self):
        try:
            if self.proc.poll() is None:
                self.send({"cmd": "shutdown"})
                self.proc.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            self.proc.kill()
            self.proc.wait(timeout=5)
        finally:
            for stream in (self.proc.stdin, self.proc.stdout, self.proc.stderr):
                try:
                    stream.close()
                except Exception:
                    pass


def validate_event(event, progress_by_job):
    assert isinstance(event, dict), event
    assert "event" in event, event
    kind = event["event"]
    assert kind in {"ready", "pong", "job", "log"}, event
    if kind == "job":
        missing = JOB_KEYS - set(event)
        assert not missing, f"job event missing {sorted(missing)}: {event}"
        assert isinstance(event["id"], str) and event["id"], event
        assert event["status"] in {"resolving", "downloading", "paused", "packing", "done", "error", "cancelled"}, event
        assert isinstance(event["progress"], int) and 0 <= event["progress"] <= 100, event
        assert isinstance(event["downloaded"], int) and event["downloaded"] >= 0, event
        assert isinstance(event["total"], int) and event["total"] >= 0, event
        assert event["title"] is None or isinstance(event["title"], str), event
        assert event["outputPath"] is None or isinstance(event["outputPath"], str), event
        assert event["message"] is None or isinstance(event["message"], str), event
        assert event["error"] is None or isinstance(event["error"], str), event
        previous = progress_by_job.get(event["id"], 0)
        assert event["progress"] >= previous, f"progress went backwards: {event}"
        progress_by_job[event["id"]] = event["progress"]
    elif kind == "log":
        assert event.get("level") in {"info", "warn", "error"}, event
        assert isinstance(event.get("message"), str), event
    elif kind == "pong":
        assert "queued" in event, event


def wait_terminal(worker, job_id, timeout=40):
    progress_by_job = {}
    collected = []

    def matches(event):
        if event.get("event") != "job" or event.get("id") != job_id:
            return False
        validate_event(event, progress_by_job)
        return event.get("status") in TERMINAL

    while True:
        event = worker.next_event(timeout)
        collected.append(event)
        if matches(event):
            return event, collected


def check_zip(zip_path, source_images, expected_names):
    path = Path(zip_path)
    assert path.is_file(), f"missing ZIP: {path}"
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, f"corrupt ZIP: {path}"
        names = sorted(archive.namelist())
        assert names == expected_names, (names, expected_names)
        for name, source in zip(expected_names, source_images):
            assert archive.read(name) == source.read_bytes(), f"content mismatch in {name}"


def assert_inside(path, parent):
    path = Path(path).resolve()
    parent = Path(parent).resolve()
    assert path == parent or parent in path.parents, f"{path} is outside {parent}"


def main():
    random.seed(1234)
    temp_root = Path(tempfile.mkdtemp(prefix="yopomura-smoke-"))
    www = temp_root / "www"
    images_dir = www / "img"
    images_dir.mkdir(parents=True)
    images = []
    for index in (1, 2, 3):
        data = make_png(index)
        (images_dir / f"{index}.png").write_bytes(data)
        images.append(images_dir / f"{index}.png")

    # Throttled copies used by the pause test so a download is still streaming
    # when the pause command lands.
    slow_images_dir = www / "slowimg"
    slow_images_dir.mkdir(parents=True)
    for image in images:
        (slow_images_dir / image.name).write_bytes(image.read_bytes())

    (temp_root / "fake_extractor.py").write_text(FAKE_EXTRACTOR, encoding="utf-8")

    env = os.environ.copy()
    env["PYTHONPATH"] = str(temp_root) + os.pathsep + env.get("PYTHONPATH", "")
    env["YOPOMURA_DOWNLOADER_EXTRACTOR_MODULE"] = "fake_extractor"

    worker = None
    try:
        with LocalServer(www) as server:
            env["SMOKE_BASE_URL"] = server.base_url
            worker = WorkerProcess(env)

            ready = worker.next_event(10)
            assert ready == {"event": "ready"}, ready

            worker.send({"cmd": "ping"})
            pong = worker.wait_for(lambda e: e.get("event") == "pong", 5, "pong")
            assert pong.get("queued") == 0, pong
            assert pong.get("active") is None, pong

            out_main = temp_root / "out-main"
            worker.send({
                "cmd": "add",
                "id": "job-main",
                "url": server.base_url + "/plain",
                "outDir": str(out_main),
                "keepFolder": False,
            })
            done, events = wait_terminal(worker, "job-main")
            statuses = [e["status"] for e in events if e.get("event") == "job" and e.get("id") == "job-main"]
            assert statuses[0] == "resolving", statuses
            assert "downloading" in statuses and "packing" in statuses, statuses
            assert done["status"] == "done", done
            assert done["downloaded"] == 3 and done["total"] == 3, done
            assert done["progress"] == 100 and done["title"] == "Smoke Manga", done
            assert done["outputPath"], done
            assert_inside(done["outputPath"], out_main)
            check_zip(done["outputPath"], images, ["001.png", "002.png", "003.png"])
            assert not list(out_main.glob("_temp_*")), "temporary folder left behind"
            assert not list(out_main.glob("*.part")), "partial file left behind"
            print("PASS job-main: ZIP downloaded, packed and verified")

            # A second job with the same title must not overwrite the first ZIP.
            worker.send({
                "cmd": "add",
                "id": "job-main-dup",
                "url": server.base_url + "/plain",
                "outDir": str(out_main),
                "keepFolder": False,
            })
            done_dup, _ = wait_terminal(worker, "job-main-dup")
            assert done_dup["status"] == "done", done_dup
            assert done_dup["outputPath"] == str(out_main / "Smoke Manga (2).zip"), done_dup
            check_zip(done_dup["outputPath"], images, ["001.png", "002.png", "003.png"])
            assert Path(done["outputPath"]).is_file(), "duplicate job replaced the first ZIP"
            print("PASS job-main-dup: duplicate output names are numbered, nothing overwritten")

            out_keep = temp_root / "out-keep"
            worker.send({
                "cmd": "add",
                "id": "job-keep",
                "url": server.base_url + "/keep",
                "outDir": str(out_keep),
                "keepFolder": True,
            })
            done_keep, _ = wait_terminal(worker, "job-keep")
            assert done_keep["status"] == "done", done_keep
            assert done_keep["title"] == "Smoke Manga Keep", done_keep
            assert_inside(done_keep["outputPath"], out_keep)
            check_zip(done_keep["outputPath"], images, ["001.png", "002.png", "003.png"])
            folder = out_keep / "Smoke Manga Keep"
            assert folder.is_dir(), f"keepFolder image folder missing: {folder}"
            assert sorted(p.name for p in folder.iterdir()) == ["001.png", "002.png", "003.png"]
            print("PASS job-keep: keepFolder preserved the image folder")

            out_pause = temp_root / "out-pause"
            worker.send({
                "cmd": "add",
                "id": "job-pause",
                "url": server.base_url + "/pausable",
                "outDir": str(out_pause),
                "keepFolder": False,
            })
            worker.wait_for(
                lambda e: e.get("event") == "job"
                and e.get("id") == "job-pause"
                and e.get("status") == "downloading",
                10,
                "job-pause to start downloading",
            )
            worker.send({"cmd": "pause"})
            paused = worker.wait_for(
                lambda e: e.get("event") == "job"
                and e.get("id") == "job-pause"
                and e.get("status") == "paused",
                10,
                "job-pause paused event",
            )
            assert paused["total"] == 3, paused
            assert paused["downloaded"] < 3 and paused["progress"] < 100, paused
            assert paused["message"] == "Paused", paused

            out_queued = temp_root / "out-queued"
            worker.send({
                "cmd": "add",
                "id": "job-queued",
                "url": server.base_url + "/queued",
                "outDir": str(out_queued),
                "keepFolder": False,
            })
            worker.send({"cmd": "ping"})
            pong = worker.wait_for(lambda e: e.get("event") == "pong", 5, "pong while paused")
            assert pong.get("paused") is True, pong

            held = worker.drain(0.6)
            held_progress = {}
            for event in held:
                validate_event(event, held_progress)
                if event.get("event") != "job":
                    continue
                if event.get("id") == "job-pause":
                    assert event["status"] == "paused", f"progress while paused: {event}"
                elif event.get("id") == "job-queued":
                    raise AssertionError(f"queued job started while paused: {event}")
            assert not any(
                e.get("event") == "job" and e.get("status") in TERMINAL for e in held
            ), f"terminal event while paused: {held}"

            worker.send({"cmd": "resume"})
            worker.wait_for(
                lambda e: e.get("event") == "job"
                and e.get("id") == "job-pause"
                and e.get("status") == "downloading",
                10,
                "job-pause to resume downloading",
            )
            unpaused, _ = wait_terminal(worker, "job-pause")
            assert unpaused["status"] == "done", unpaused
            assert unpaused["downloaded"] == 3 and unpaused["total"] == 3, unpaused
            assert unpaused["progress"] == 100, unpaused
            assert_inside(unpaused["outputPath"], out_pause)
            check_zip(unpaused["outputPath"], images, ["001.png", "002.png", "003.png"])
            assert not list(out_pause.glob("_temp_*")), "temporary folder left behind"
            assert not list(out_pause.glob("*.part")), "partial file left behind"
            print("PASS job-pause: pause stopped streaming, resume finished the job")

            queued_done, _ = wait_terminal(worker, "job-queued")
            assert queued_done["status"] == "done", queued_done
            check_zip(queued_done["outputPath"], images, ["001.png", "002.png", "003.png"])
            print("PASS job-queued: queue stayed held while paused, then ran after resume")

            out_pause_cancel = temp_root / "out-pause-cancel"
            worker.send({
                "cmd": "add",
                "id": "job-pause-cancel",
                "url": server.base_url + "/pausable",
                "outDir": str(out_pause_cancel),
                "keepFolder": False,
            })
            worker.wait_for(
                lambda e: e.get("event") == "job"
                and e.get("id") == "job-pause-cancel"
                and e.get("status") == "downloading",
                10,
                "job-pause-cancel to start downloading",
            )
            worker.send({"cmd": "pause"})
            worker.wait_for(
                lambda e: e.get("event") == "job"
                and e.get("id") == "job-pause-cancel"
                and e.get("status") == "paused",
                10,
                "job-pause-cancel paused event",
            )
            worker.send({"cmd": "cancel", "id": "job-pause-cancel"})
            cancelled_pause, _ = wait_terminal(worker, "job-pause-cancel")
            assert cancelled_pause["status"] == "cancelled", cancelled_pause
            if out_pause_cancel.exists():
                assert not list(out_pause_cancel.glob("*.part")), "partial file left behind"
                assert not list(out_pause_cancel.glob("_temp_*")), "temporary folder left behind"
            print("PASS job-pause-cancel: cancel works while paused")

            worker.send({"cmd": "resume"})
            worker.send({"cmd": "ping"})
            pong = worker.wait_for(lambda e: e.get("event") == "pong", 5, "pong after idle resume")
            assert pong.get("paused") is False and pong.get("active") is None, pong

            out_cancel = temp_root / "out-cancel"
            worker.send({
                "cmd": "add",
                "id": "job-cancel",
                "url": server.base_url + "/slow",
                "outDir": str(out_cancel),
                "keepFolder": False,
            })
            worker.send({"cmd": "cancel", "id": "job-cancel"})
            cancelled, _ = wait_terminal(worker, "job-cancel")
            assert cancelled["status"] == "cancelled", cancelled
            if out_cancel.exists():
                assert not list(out_cancel.glob("*.part")), "partial file left behind"
                assert not list(out_cancel.glob("_temp_*")), "temporary folder left behind"
            print("PASS job-cancel: cancellation produced a cancelled terminal event")

            out_error = temp_root / "out-error"
            worker.send({
                "cmd": "add",
                "id": "job-error",
                "url": server.base_url + "/boom",
                "outDir": str(out_error),
                "keepFolder": False,
            })
            failed, _ = wait_terminal(worker, "job-error")
            assert failed["status"] == "error", failed
            assert failed["error"], failed
            assert not out_error.exists() or not list(out_error.iterdir()), "error job left files behind"
            print("PASS job-error: extractor failure produced an error event")

            worker.send({"cmd": "ping"})
            pong = worker.wait_for(lambda e: e.get("event") == "pong", 5, "final pong")
            assert pong.get("queued") == 0 and pong.get("active") is None, pong
            assert pong.get("paused") is False, pong

            worker.send({"cmd": "pause"})
            worker.send({"cmd": "ping"})
            pong = worker.wait_for(lambda e: e.get("event") == "pong", 5, "pong before shutdown")
            assert pong.get("paused") is True, pong
            worker.send({"cmd": "shutdown"})
            assert worker.proc.wait(timeout=5) == 0, "worker did not exit while paused"
            print("PASS shutdown: worker exits cleanly while paused")

        terminals = Counter(
            event["id"]
            for event in worker.seen
            if event.get("event") == "job" and event.get("status") in TERMINAL
        )
        duplicated = {job_id: count for job_id, count in terminals.items() if count != 1}
        assert not duplicated, f"expected exactly one terminal event per job, got {duplicated}"
        assert not worker.protocol_errors, worker.protocol_errors
        print(f"PASS protocol: {len(worker.seen)} worker events were valid JSON lines")
        print(f"PASS terminal: one terminal event for each of {len(terminals)} jobs")
        print("SMOKE TEST PASSED")
        return 0
    finally:
        if worker is not None:
            worker.close()
        shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(f"SMOKE TEST FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
