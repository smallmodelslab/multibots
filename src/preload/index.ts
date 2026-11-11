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
  allowScreen: () => ipcRenderer.invoke("openbots:allow-screen"),
  call: (command) => ipcRenderer.invoke("openbots:call", command),
  checkForUpdate: () => ipcRenderer.invoke("openbots:update-check"),
  connectModel: (kind, input) =>
    ipcRenderer.invoke("openbots:connect-model", kind, input),
  connectPlugin: (slug) => ipcRenderer.invoke("openbots:connect-plugin", slug),
  disconnectModel: (id) => ipcRenderer.invoke("openbots:disconnect-model", id),
  disconnectPlugin: (slug) =>
    ipcRenderer.invoke("openbots:disconnect-plugin", slug),
  grokBots: () => ipcRenderer.invoke("openbots:grok-bots"),
  installMultidesktop: () =>
    ipcRenderer.invoke("openbots:install-multidesktop"),
  installUpdate: () => ipcRenderer.invoke("openbots:update-install"),
  onChange: listen<Change>("openbots:change"),
  onState: listen<AppState>("openbots:state"),
  openFile: (botId, path) =>
    ipcRenderer.invoke("openbots:open-file", botId, path),
  openFolder: (botId) => ipcRenderer.invoke("openbots:open-folder", botId),
  pair: (code) => ipcRenderer.invoke("openbots:pair", code),
  orderModels: (list, order) =>
    ipcRenderer.invoke("openbots:order-models", list, order),
  platform: process.platform,
  plugins: (query) => ipcRenderer.invoke("openbots:plugins", query),
  ready: () => ipcRenderer.send("openbots:ready"),
  reportError: (error) => ipcRenderer.send("openbots:error", error),
  setAnalytics: (on) => ipcRenderer.invoke("openbots:analytics", on),
  setChannel: (channel) =>
    ipcRenderer.invoke("openbots:update-channel", channel),
  setComposioKey: (key) => ipcRenderer.invoke("openbots:composio-key", key),
  setFlags: (flags) => ipcRenderer.send("openbots:flags", flags),
  setUpChrome: () => ipcRenderer.invoke("openbots:set-up-chrome"),
  setServer: (on) => ipcRenderer.invoke("openbots:server", on),
  signInMultidesktop: () => ipcRenderer.invoke("openbots:sign-in-multidesktop"),
  servedModels: (address, key) =>
    ipcRenderer.invoke("openbots:served-models", address, key),
  signIn: () => ipcRenderer.invoke("openbots:sign-in"),
  signOut: () => ipcRenderer.invoke("openbots:sign-out"),
  state: () => ipcRenderer.invoke("openbots:state"),
};

contextBridge.exposeInMainWorld("openbots", bridge);
