/// <reference types="chrome" />

// Whether OpenBots is connected and bots are at work, and the button that
// stops every bot in Chrome, or lets them go on.

const statusLine = document.querySelector<HTMLParagraphElement>("#status")!;
const toggle = document.querySelector<HTMLButtonElement>("#toggle")!;

type State = {
  connected: boolean;
  stopped: boolean;
  tabs: number;
  error?: string;
};

const show = ({ connected, error, stopped, tabs }: State) => {
  statusLine.textContent = error
    ? error
    : !connected
      ? "Open OpenBots on this computer. Chrome connects to it by itself."
      : stopped
        ? "Bots are stopped. Their tabs stay as they were."
        : tabs
          ? `Bots are using ${tabs === 1 ? "1 tab" : `${tabs} tabs`} of their own.`
          : "Connected. Bots open tabs of their own when they need them.";
  toggle.hidden = !connected;
  toggle.textContent = stopped ? "Let bots go on" : "Stop bots";
};

const ask = async (message: string) =>
  show((await chrome.runtime.sendMessage(message)) as State);

toggle.onclick = () =>
  void ask(toggle.textContent === "Stop bots" ? "stop" : "go on");
void ask("connect");
setInterval(() => void ask("status"), 1000);
