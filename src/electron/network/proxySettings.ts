import fs from "node:fs";
import path from "node:path";
import type {
    ProxyConfig,
    ProxyMode,
    ProxyProtocol,
    ProxySaveResult,
    ProxyState,
    ProxyTestResult,
} from "@common/types/network";
import { createMainLogger } from "@electron/util/logger";
import { app, net, type Session, safeStorage, session } from "electron";

const logger = createMainLogger("network/proxy");

/** The integrated browser owns this partition; the proxy applies to it only. */
const BROWSER_PARTITION = "persist:browser";
const SETTINGS_FILE = "network-proxy.json";
const TEST_URL = "https://ipwho.is/";
const TEST_TIMEOUT_MS = 20_000;

type StoredProxy = {
    config: ProxyConfig;
    /** Base64 payload produced by safeStorage, or legacy base64 when unavailable. */
    passwordEnc?: string;
    /** True when passwordEnc came from safeStorage. */
    passwordProtected?: boolean;
};

const DEFAULT_BYPASS = "<local>,localhost,127.0.0.1";

const DEFAULT_CONFIG: ProxyConfig = {
    mode: "system",
    protocol: "http",
    host: "",
    port: 0,
    username: "",
    bypass: DEFAULT_BYPASS,
};

let cached: StoredProxy | null = null;
let cachedPassword: string | null = null;
let loginHandlerRegistered = false;
let testCredentials: { username: string; password: string } | null = null;
let lastApplied = "";

const settingsPath = (): string => path.join(app.getPath("userData"), SETTINGS_FILE);

const isMode = (value: unknown): value is ProxyMode =>
    value === "system" || value === "direct" || value === "manual";

const isProtocol = (value: unknown): value is ProxyProtocol =>
    value === "http" || value === "https" || value === "socks5";

const normalizeConfig = (value: Partial<ProxyConfig> | undefined): ProxyConfig => {
    const config = { ...DEFAULT_CONFIG, ...(value ?? {}) };
    return {
        mode: isMode(config.mode) ? config.mode : "system",
        protocol: isProtocol(config.protocol) ? config.protocol : "http",
        host: typeof config.host === "string" ? config.host.trim() : "",
        port: Number.isFinite(config.port) ? Math.max(0, Math.min(65_535, Math.trunc(config.port))) : 0,
        username: typeof config.username === "string" ? config.username : "",
        bypass: typeof config.bypass === "string" && config.bypass.trim() ? config.bypass : DEFAULT_BYPASS,
    };
};

const encryptPassword = (password: string): { value: string; protected: boolean } => {
    if (password && safeStorage.isEncryptionAvailable()) {
        try {
            return { value: safeStorage.encryptString(password).toString("base64"), protected: true };
        } catch (error) {
            logger.warn("safeStorage encryption failed; using local encoding", error);
        }
    }
    return { value: Buffer.from(password, "utf8").toString("base64"), protected: false };
};

const decryptPassword = (stored: StoredProxy): string => {
    if (!stored.passwordEnc) return "";
    try {
        const bytes = Buffer.from(stored.passwordEnc, "base64");
        if (stored.passwordProtected && safeStorage.isEncryptionAvailable()) {
            return safeStorage.decryptString(bytes);
        }
        return bytes.toString("utf8");
    } catch (error) {
        logger.warn("could not decrypt stored proxy password", error);
        return "";
    }
};

const readStored = (): StoredProxy => {
    if (cached) return cached;
    try {
        const raw = fs.readFileSync(settingsPath(), "utf8");
        const parsed = JSON.parse(raw) as Partial<StoredProxy>;
        cached = {
            config: normalizeConfig(parsed.config),
            passwordEnc: typeof parsed.passwordEnc === "string" ? parsed.passwordEnc : undefined,
            passwordProtected: Boolean(parsed.passwordProtected),
        };
    } catch {
        cached = { config: { ...DEFAULT_CONFIG } };
    }
    cachedPassword = decryptPassword(cached);
    return cached;
};

const writeStored = (next: StoredProxy): void => {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
    cached = next;
    cachedPassword = decryptPassword(next);
};

const proxyRulesFor = (config: ProxyConfig): string | null => {
    if (config.mode !== "manual") return null;
    if (!config.host || !config.port) return null;
    return `${config.protocol}://${config.host}:${config.port}`;
};

const ensureLoginHandler = (): void => {
    if (loginHandlerRegistered) return;
    loginHandlerRegistered = true;
    app.on("login", (event, _webContents, _details, authInfo, callback) => {
        if (!authInfo.isProxy) return;
        const stored = readStored();
        const credentials = testCredentials ?? {
            username: stored.config.username,
            password: cachedPassword ?? "",
        };
        if (!credentials.username && !credentials.password) return;
        event.preventDefault();
        callback(credentials.username, credentials.password);
    });
};

/** Applies the stored proxy to one session. */
export const applyProxyToSession = async (target: Session): Promise<void> => {
    ensureLoginHandler();
    const stored = readStored();
    const rules = proxyRulesFor(stored.config);
    try {
        if (stored.config.mode === "manual" && rules) {
            await target.setProxy({
                mode: "fixed_servers",
                proxyRules: rules,
                proxyBypassRules: stored.config.bypass,
            });
            lastApplied = rules;
        } else if (stored.config.mode === "direct") {
            await target.setProxy({ mode: "direct" });
            lastApplied = "direct";
        } else {
            await target.setProxy({ mode: "system" });
            lastApplied = "system";
        }
        logger.info("proxy applied", { mode: stored.config.mode, rules: rules ?? null });
    } catch (error) {
        logger.error("could not apply proxy", error);
        throw error;
    }
};

/** Applies to the integrated browser session (no other app traffic). */
export const applyProxyToBrowserSession = async (): Promise<void> => {
    await applyProxyToSession(session.fromPartition(BROWSER_PARTITION));
};

export const getProxyState = (): ProxyState => {
    const stored = readStored();
    const rules = proxyRulesFor(stored.config);
    return {
        config: stored.config,
        hasPassword: Boolean(stored.passwordEnc),
        passwordProtected: Boolean(stored.passwordProtected),
        applied: stored.config.mode === "manual" ? lastApplied === rules : true,
    };
};

export const saveProxyConfig = async (input: {
    config: Partial<ProxyConfig>;
    password?: string;
}): Promise<ProxySaveResult> => {
    const config = normalizeConfig(input.config);
    if (config.mode === "manual") {
        if (!/^[a-z0-9.-]+$/i.test(config.host)) {
            return { ok: false, message: "Enter a valid proxy hostname." };
        }
        if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
            return { ok: false, message: "Enter a valid proxy port (1–65535)." };
        }
    }

    const stored = readStored();
    let passwordEnc = stored.passwordEnc;
    let passwordProtected = stored.passwordProtected;
    if (input.password !== undefined) {
        const encrypted = encryptPassword(input.password);
        passwordEnc = input.password ? encrypted.value : undefined;
        passwordProtected = input.password ? encrypted.protected : undefined;
    }

    const next: StoredProxy = { config, passwordEnc, passwordProtected };
    try {
        writeStored(next);
        await applyProxyToBrowserSession();
        return { ok: true, state: getProxyState() };
    } catch (error) {
        return {
            ok: false,
            message: error instanceof Error ? error.message : "Could not save the proxy settings.",
        };
    }
};

const requestText = (target: Session, url: string): Promise<string> =>
    new Promise((resolve, reject) => {
        const request = net.request({ url, session: target, useSessionCookies: false });
        const timer = setTimeout(() => {
            request.abort();
            reject(new Error("Proxy test timed out."));
        }, TEST_TIMEOUT_MS);
        request.on("response", (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => {
                clearTimeout(timer);
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`Proxy test returned HTTP ${response.statusCode}.`));
                    return;
                }
                resolve(Buffer.concat(chunks).toString("utf8"));
            });
        });
        request.on("login", (_authInfo, callback) => {
            const credentials = testCredentials;
            if (credentials) callback(credentials.username, credentials.password);
            else callback();
        });
        request.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        request.end();
    });

/**
 * Tests a proxy candidate on a throwaway in-memory session so a bad proxy does
 * not disturb the live browser while the user is editing the form.
 */
export const testProxy = async (input: {
    config: Partial<ProxyConfig>;
    password?: string;
}): Promise<ProxyTestResult> => {
    const config = normalizeConfig(input.config);
    const rules = proxyRulesFor(config);
    if (!rules) return { ok: false, message: "Enter a manual proxy first." };

    const previousTestCredentials = testCredentials;
    testCredentials = {
        username: config.username,
        password: input.password ?? cachedPassword ?? "",
    };
    const target = session.fromPartition(`proxy-test-${Date.now()}`);
    const started = Date.now();

    try {
        await target.setProxy({
            mode: "fixed_servers",
            proxyRules: rules,
            proxyBypassRules: config.bypass,
        });
        const body = await requestText(target, TEST_URL);
        const payload = JSON.parse(body) as { success?: boolean; ip?: string; country?: string };
        if (payload.success === false || !payload.ip) {
            return { ok: false, message: "The proxy connected but the IP check failed." };
        }
        return {
            ok: true,
            ip: payload.ip,
            country: typeof payload.country === "string" ? payload.country : "",
            latencyMs: Date.now() - started,
        };
    } catch (error) {
        logger.warn("proxy test failed", error instanceof Error ? error.message : error);
        return {
            ok: false,
            message: error instanceof Error ? error.message : "Could not connect through the proxy.",
        };
    } finally {
        testCredentials = previousTestCredentials;
        await target.setProxy({ mode: "direct" }).catch(() => undefined);
    }
};

/** Environment variables for the Python downloader (HTTP/HTTPS proxies only). */
export const getProxyEnvironment = (): Record<string, string> => {
    const stored = readStored();
    const rules = proxyRulesFor(stored.config);
    if (!rules || (stored.config.protocol !== "http" && stored.config.protocol !== "https")) return {};
    const auth = stored.config.username
        ? `${encodeURIComponent(stored.config.username)}:${encodeURIComponent(cachedPassword ?? "")}@`
        : "";
    const url = `${stored.config.protocol}://${auth}${stored.config.host}:${stored.config.port}`;
    return {
        HTTP_PROXY: url,
        HTTPS_PROXY: url,
        ALL_PROXY: url,
        NO_PROXY: "localhost,127.0.0.1,::1",
    };
};
