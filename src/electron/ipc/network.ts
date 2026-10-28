import { getProxyState, saveProxyConfig, testProxy } from "@electron/network/proxySettings";
import { ipc } from "./utils";

export const registerNetworkHandlers = (): void => {
    ipc.handle("network:getProxy", () => getProxyState());
    ipc.handle("network:setProxy", (_event, request) => saveProxyConfig(request));
    ipc.handle("network:testProxy", (_event, request) => testProxy(request));
};
