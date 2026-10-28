/** How the browser session chooses its network route. */
export type ProxyMode = "system" | "direct" | "manual";

/** Supported proxy protocols. */
export type ProxyProtocol = "http" | "https" | "socks5";

/** Editable proxy configuration (the password is stored separately). */
export type ProxyConfig = {
    mode: ProxyMode;
    protocol: ProxyProtocol;
    host: string;
    port: number;
    username: string;
    /** Extra Chromium bypass rules, comma separated. */
    bypass: string;
};

/** Public state returned to the settings UI; never includes the password. */
export type ProxyState = {
    config: ProxyConfig;
    hasPassword: boolean;
    /** False when the OS credential store is unavailable. */
    passwordProtected: boolean;
    /** Browser session proxy matches the stored manual config. */
    applied: boolean;
};

export type ProxyTestResult =
    | {
          ok: true;
          ip: string;
          country: string;
          latencyMs: number;
      }
    | { ok: false; message: string };

export type ProxySaveResult = { ok: true; state: ProxyState } | { ok: false; message: string };
