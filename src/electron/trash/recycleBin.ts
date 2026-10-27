import { type ExecFileException, execFile } from "node:child_process";
import path from "node:path";
import { createMainLogger } from "@electron/util/logger";

const logger = createMainLogger("trash/recycleBin");

/** Give Shell.Application enough time to enumerate a large bin without hanging forever. */
const RESTORE_TIMEOUT_MS = 15_000;

/** Result of {@link restoreFromRecycleBin}. */
export type RestoreFromRecycleBinResult = { ok: true } | { ok: false; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const UNSUPPORTED_MESSAGE = "Recycle Bin restore is unsupported on this platform (Windows only).";

/**
 * Enumerates the Windows Recycle Bin and restores the item whose
 * `System.Recycle.DeletedFrom` + `Name` equals `originalPath`.
 *
 * The path is passed through `YOMIKIRU_TRASH_PATH` so it never has to survive
 * PowerShell quoting. Returns a clear message when the item is gone, the
 * original path is occupied, or Windows refuses the restore.
 */
export const restoreFromRecycleBin = async (originalPath: string): Promise<RestoreFromRecycleBinResult> => {
    if (process.platform !== "win32") return { ok: false, message: UNSUPPORTED_MESSAGE };
    if (typeof originalPath !== "string" || originalPath.trim().length === 0) {
        return { ok: false, message: "No original path was provided for the Recycle Bin restore." };
    }

    const target = path.resolve(originalPath);
    const outcome = await runPowerShell(target);
    const parsed = parsePowerShellResult(outcome.stdout);
    if (parsed) return parsed;

    if (outcome.error?.killed) {
        return {
            ok: false,
            message: `Windows Recycle Bin restore timed out after ${RESTORE_TIMEOUT_MS / 1000}s.`,
        };
    }

    const detail = outcome.stderr.trim() || outcome.error?.message.trim() || "PowerShell returned no result.";
    logger.error("Recycle Bin restore failed", { target, detail });
    return {
        ok: false,
        message: `Windows could not restore "${target}" from the Recycle Bin: ${detail}`,
    };
};

type PowerShellOutcome = {
    stdout: string;
    stderr: string;
    error: ExecFileException | null;
};

const runPowerShell = (target: string): Promise<PowerShellOutcome> =>
    new Promise((resolve) => {
        execFile(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                RECYCLE_BIN_RESTORE_SCRIPT,
            ],
            {
                timeout: RESTORE_TIMEOUT_MS,
                windowsHide: true,
                maxBuffer: 1024 * 1024,
                encoding: "utf8",
                env: { ...process.env, YOMIKIRU_TRASH_PATH: target },
            },
            (error: ExecFileException | null, stdout: string, stderr: string) => {
                resolve({
                    stdout: typeof stdout === "string" ? stdout : String(stdout ?? ""),
                    stderr: typeof stderr === "string" ? stderr : String(stderr ?? ""),
                    error,
                });
            },
        );
    });

/** Extracts the JSON payload even when PowerShell emitted an unrelated warning first. */
const parsePowerShellResult = (stdout: string): RestoreFromRecycleBinResult | null => {
    const text = stdout.trim();
    if (text.length === 0) return null;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;

    let value: unknown;
    try {
        value = JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
    if (!isRecord(value) || typeof value.ok !== "boolean") return null;
    if (value.ok) return { ok: true };

    const message =
        typeof value.message === "string" && value.message.trim().length > 0
            ? value.message.trim()
            : "Windows did not restore the item from the Recycle Bin.";
    return { ok: false, message };
};

/**
 * PowerShell 5.1 Shell.Application restore. Kept as a constant so tests can
 * inspect the strategy without launching a real restore.
 *
 * Matching uses the original folder plus the item name because
 * `System.Recycle.DeletedFrom` does not include the item name. `InvokeVerb`
 * uses the canonical English verb; the `Verbs()` fallback handles localized
 * shells (Vietnamese, Japanese, Chinese) where that lookup can fail.
 */
export const RECYCLE_BIN_RESTORE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$target = $env:YOMIKIRU_TRASH_PATH
$result = @{ ok = $false; message = '' }

function Get-NormalizedPath([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return '' }
    try { return [System.IO.Path]::GetFullPath($value).TrimEnd('\') }
    catch { return $value.TrimEnd('\') }
}

function Exit-WithResult {
    [Console]::Out.Write((ConvertTo-Json -InputObject $result -Compress))
    exit 0
}

try {
    if ([string]::IsNullOrWhiteSpace($target)) {
        $result.message = 'No original path was provided for the Recycle Bin restore.'
        Exit-WithResult
    }

    $wanted = Get-NormalizedPath $target
    if (Test-Path -LiteralPath $wanted) {
        $result.message = "An item already exists at '$wanted'; move it away before restoring."
        Exit-WithResult
    }

    $shell = New-Object -ComObject Shell.Application
    $recycleBin = $shell.Namespace(10)
    if ($null -eq $recycleBin) {
        $result.message = 'The Windows Recycle Bin is not available.'
        Exit-WithResult
    }

    $match = $null
    $matchDeletedAt = $null
    foreach ($item in @($recycleBin.Items())) {
        try {
            $deletedFrom = [string]$item.ExtendedProperty('System.Recycle.DeletedFrom')
            if ([string]::IsNullOrWhiteSpace($deletedFrom)) { continue }
            $candidate = Get-NormalizedPath ([System.IO.Path]::Combine($deletedFrom, [string]$item.Name))
            if (-not [string]::Equals($candidate, $wanted, [System.StringComparison]::OrdinalIgnoreCase)) { continue }

            $deletedAt = $null
            try { $deletedAt = [datetime]$item.ExtendedProperty('System.Recycle.DateDeleted') } catch { }
            if ($null -eq $match -or ($null -ne $deletedAt -and ($null -eq $matchDeletedAt -or $deletedAt -gt $matchDeletedAt))) {
                $match = $item
                $matchDeletedAt = $deletedAt
            }
        } catch { }
    }

    if ($null -eq $match) {
        $result.message = "No item matching '$wanted' was found in the Windows Recycle Bin."
        Exit-WithResult
    }

    $restored = $false
    try { $match.InvokeVerb('RESTORE') } catch { }
    Start-Sleep -Milliseconds 400
    if (Test-Path -LiteralPath $wanted) { $restored = $true }

    if (-not $restored) {
        $restoreVerb = $null
        foreach ($verb in @($match.Verbs())) {
            $verbName = ([string]$verb.Name).Replace('&', '').Trim()
            if ($verbName -imatch '^(restore|khôi phục|phục hồi|復元|元に戻す|还原|還原)$') {
                $restoreVerb = $verb
                break
            }
        }
        if ($null -ne $restoreVerb) {
            try { $restoreVerb.DoIt() } catch { }
            Start-Sleep -Milliseconds 400
            if (Test-Path -LiteralPath $wanted) { $restored = $true }
        }
    }

    if ($restored) {
        $result.ok = $true
        $result.message = $null
    } else {
        $result.message = "Windows did not restore '$wanted'. The item may have been removed from the Recycle Bin or blocked by permissions."
    }
} catch {
    $result.ok = $false
    $result.message = "Recycle Bin restore failed: $($_.Exception.Message)"
}

Exit-WithResult
`;
