import type { ProxyConfig, ProxyMode, ProxyProtocol, ProxyState, ProxyTestResult } from "@common/types/network";
import { useEffect, useState } from "react";
import "./proxySettings.scss";

type FormState = {
    mode: ProxyMode;
    protocol: ProxyProtocol;
    host: string;
    port: string;
    username: string;
    password: string;
    bypass: string;
};

const EMPTY_FORM: FormState = {
    mode: "system",
    protocol: "http",
    host: "",
    port: "",
    username: "",
    password: "",
    bypass: "<local>,localhost,127.0.0.1",
};

const formFromConfig = (config: ProxyConfig): FormState => ({
    mode: config.mode,
    protocol: config.protocol,
    host: config.host,
    port: config.port > 0 ? String(config.port) : "",
    username: config.username,
    password: "",
    bypass: config.bypass,
});

const toConfig = (form: FormState): ProxyConfig => ({
    mode: form.mode,
    protocol: form.protocol,
    host: form.host.trim(),
    port: Number.parseInt(form.port, 10) || 0,
    username: form.username,
    bypass: form.bypass,
});

/** Settings section for the integrated browser's HTTP/SOCKS5 proxy. */
const ProxySettings = () => {
    const [state, setState] = useState<ProxyState | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [test, setTest] = useState<ProxyTestResult | null>(null);

    const load = async () => {
        const next = await window.electron.invoke("network:getProxy");
        setState(next);
        setForm(formFromConfig(next.config));
    };

    // biome-ignore lint/correctness/useExhaustiveDependencies: initial settings load only
    useEffect(() => {
        void load().catch((reason: unknown) =>
            setError(reason instanceof Error ? reason.message : String(reason)),
        );
    }, []);

    const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm((previous) => ({ ...previous, [key]: value }));
        setMessage("");
        setError("");
        setTest(null);
    };

    const save = async (password?: string) => {
        if (busy) return;
        setBusy(true);
        setMessage("");
        setError("");
        try {
            const result = await window.electron.invoke("network:setProxy", {
                config: toConfig(form),
                ...(password !== undefined ? { password } : {}),
            });
            if (!result.ok) {
                setError(result.message);
                return;
            }
            setState(result.state);
            setForm((previous) => ({ ...previous, password: "" }));
            setMessage(
                form.mode === "manual"
                    ? "Proxy saved and applied to the integrated browser."
                    : form.mode === "direct"
                      ? "Browser proxy disabled (direct connection)."
                      : "Browser now follows the Windows system proxy.",
            );
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    };

    const runTest = async () => {
        if (busy) return;
        setBusy(true);
        setMessage("");
        setError("");
        setTest(null);
        try {
            const result = await window.electron.invoke("network:testProxy", {
                config: toConfig(form),
                ...(form.password ? { password: form.password } : {}),
            });
            setTest(result);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    };

    const clearPassword = async () => {
        setBusy(true);
        setError("");
        setMessage("");
        try {
            const result = await window.electron.invoke("network:setProxy", {
                config: toConfig(form),
                password: "",
            });
            if (!result.ok) {
                setError(result.message);
                return;
            }
            setState(result.state);
            setMessage("Saved proxy password removed.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="settingItem2" id="settings-networkProxy" aria-busy={busy}>
            <h3>Browser proxy</h3>
            <div className="desc">
                Route only the integrated browser through an HTTP, HTTPS or SOCKS5 proxy. Other apps and the reader
                stay on your normal connection. Never use a free proxy you do not trust: it can read your traffic.
            </div>

            <div className="proxyRow">
                <label className="proxyField">
                    <span>Mode</span>
                    <select
                        value={form.mode}
                        onChange={(event) => update("mode", event.currentTarget.value as ProxyMode)}
                    >
                        <option value="system">System proxy</option>
                        <option value="direct">Direct (no proxy)</option>
                        <option value="manual">Manual proxy</option>
                    </select>
                </label>
            </div>

            {form.mode === "manual" ? (
                <>
                    <div className="proxyGrid">
                        <label className="proxyField">
                            <span>Protocol</span>
                            <select
                                value={form.protocol}
                                onChange={(event) =>
                                    update("protocol", event.currentTarget.value as ProxyProtocol)
                                }
                            >
                                <option value="http">HTTP</option>
                                <option value="https">HTTPS</option>
                                <option value="socks5">SOCKS5</option>
                            </select>
                        </label>
                        <label className="proxyField is-grow">
                            <span>Host</span>
                            <input
                                value={form.host}
                                onChange={(event) => update("host", event.currentTarget.value)}
                                placeholder="proxy.example.com"
                                spellCheck={false}
                            />
                        </label>
                        <label className="proxyField is-port">
                            <span>Port</span>
                            <input
                                value={form.port}
                                onChange={(event) =>
                                    update("port", event.currentTarget.value.replace(/[^0-9]/g, ""))
                                }
                                placeholder="8080"
                                inputMode="numeric"
                            />
                        </label>
                        <label className="proxyField">
                            <span>Username</span>
                            <input
                                value={form.username}
                                onChange={(event) => update("username", event.currentTarget.value)}
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </label>
                        <label className="proxyField is-grow">
                            <span>Password</span>
                            <input
                                type="password"
                                value={form.password}
                                onChange={(event) => update("password", event.currentTarget.value)}
                                placeholder={state?.hasPassword ? "Saved password (unchanged)" : ""}
                                autoComplete="new-password"
                            />
                        </label>
                    </div>
                    <label className="proxyField is-wide">
                        <span>Bypass rules</span>
                        <input
                            value={form.bypass}
                            onChange={(event) => update("bypass", event.currentTarget.value)}
                            placeholder="<local>,localhost,127.0.0.1"
                            spellCheck={false}
                        />
                    </label>
                </>
            ) : null}

            <div className="proxyActions">
                <button type="button" disabled={busy} onClick={() => void save(form.password || undefined)}>
                    {busy ? "Applying…" : "Save & apply"}
                </button>
                <button type="button" disabled={busy || form.mode !== "manual"} onClick={() => void runTest()}>
                    Test proxy
                </button>
                {state?.hasPassword ? (
                    <button type="button" disabled={busy} onClick={() => void clearPassword()}>
                        Clear saved password
                    </button>
                ) : null}
            </div>

            {state?.hasPassword && !state.passwordProtected ? (
                <div className="proxyWarning">
                    Windows credential encryption is unavailable; the proxy password is only obfuscated on disk.
                </div>
            ) : null}
            {state?.hasPassword && state.passwordProtected ? (
                <div className="proxyHint">Password is encrypted with the Windows credential store.</div>
            ) : null}
            {message ? <div className="proxyMessage">{message}</div> : null}
            {error ? (
                <div className="proxyError" role="alert">
                    {error}
                </div>
            ) : null}
            {test ? (
                <output className={test.ok ? "proxyTest" : "proxyError"}>
                    {test.ok
                        ? `Proxy works · IP ${test.ip}${test.country ? ` · ${test.country}` : ""} · ${test.latencyMs} ms`
                        : `Proxy test failed: ${test.message}`}
                </output>
            ) : null}
            <div className="proxyHint">
                The Python downloader reads the HTTP/HTTPS proxy when its worker starts; restart the app or the
                worker after changing proxy settings.
            </div>
        </div>
    );
};

export default ProxySettings;
