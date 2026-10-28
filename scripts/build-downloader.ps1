$ErrorActionPreference = "Stop"

# Build the Windows sidecar consumed by DownloaderService.
# Requires Python 3.10+, requests, gallery-dl and PyInstaller.
python -m PyInstaller --noconfirm --clean --onefile --console `
    --name MangaDownloaderWorker `
    --distpath downloader `
    --workpath build/downloader-worker `
    --specpath build/downloader-worker `
    --collect-all gallery_dl `
    downloader/worker.py
