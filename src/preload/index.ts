import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { AppState, Bridge, Change } from "../shared/types";

const listen =
  <T>(channel: string) =>
  (listener: (value: T) => void) => {
    const handler = (_event: IpcRendererEvent, value: T) => listener(value);
    ipcRenderer.on(channel, handler);
    return () => void ipcRenderer.off(channel, handler);
  };

const bridge: Bridge = {
  allowScreen: () => ipcRenderer.invoke("multibots:allow-screen"),
  call: (command) => ipcRenderer.invoke("multibots:call", command),
  checkForUpdate: () => ipcRenderer.invoke("multibots:update-check"),
  connectModel: (kind, input) =>
    ipcRenderer.invoke("multibots:connect-model", kind, input),
  connectPlugin: (slug) => ipcRenderer.invoke("multibots:connect-plugin", slug),
  disconnectModel: (id) => ipcRenderer.invoke("multibots:disconnect-model", id),
  disconnectPlugin: (slug) =>
    ipcRenderer.invoke("multibots:disconnect-plugin", slug),
  grokBots: () => ipcRenderer.invoke("multibots:grok-bots"),
  installMultidesktop: () =>
    ipcRenderer.invoke("multibots:install-multidesktop"),
  installUpdate: () => ipcRenderer.invoke("multibots:update-install"),
  onChange: listen<Change>("multibots:change"),
  onState: listen<AppState>("multibots:state"),
  openFile: (botId, path) =>
    ipcRenderer.invoke("multibots:open-file", botId, path),
  openFolder: (botId) => ipcRenderer.invoke("multibots:open-folder", botId),
  pair: (code) => ipcRenderer.invoke("multibots:pair", code),
  orderModels: (list, order) =>
    ipcRenderer.invoke("multibots:order-models", list, order),
  platform: process.platform,
  plugins: (query) => ipcRenderer.invoke("multibots:plugins", query),
  ready: () => ipcRenderer.send("multibots:ready"),
  reportError: (error) => ipcRenderer.send("multibots:error", error),
  setAnalytics: (on) => ipcRenderer.invoke("multibots:analytics", on),
  setChannel: (channel) =>
    ipcRenderer.invoke("multibots:update-channel", channel),
  setComposioKey: (key) => ipcRenderer.invoke("multibots:composio-key", key),
  setFlags: (flags) => ipcRenderer.send("multibots:flags", flags),
  setUpChrome: () => ipcRenderer.invoke("multibots:set-up-chrome"),
  setServer: (on) => ipcRenderer.invoke("multibots:server", on),
  signInMultidesktop: () =>
    ipcRenderer.invoke("multibots:sign-in-multidesktop"),
  servedModels: (address, key) =>
    ipcRenderer.invoke("multibots:served-models", address, key),
  signIn: () => ipcRenderer.invoke("multibots:sign-in"),
  signOut: () => ipcRenderer.invoke("multibots:sign-out"),
  state: () => ipcRenderer.invoke("multibots:state"),
};

contextBridge.exposeInMainWorld("multibots", bridge);
