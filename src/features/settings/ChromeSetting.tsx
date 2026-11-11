import { useState } from "react";

import type { ChromeState } from "../../shared/types";
import { bridge, messageOf } from "../data";
import { Button } from "../ui/button";
import { SettingRow } from "./SettingRow";

// This server's Chrome, where its bots use tabs of their own, signed in
// where the user is: set up here, then the OpenBots extension is loaded
// from the folder it shows.
export const ChromeSetting = ({ chrome }: { chrome: ChromeState }) => {
  const [error, setError] = useState<string | null>(null);
  const setUp = () => {
    setError(null);
    bridge
      .setUpChrome()
      .catch((failure: unknown) => setError(messageOf(failure)));
  };
  return (
    <SettingRow
      action={
        chrome.connected ? null : (
          <Button onClick={setUp} size="sm">
            {chrome.setUp ? "Set up again" : "Set up"}
          </Button>
        )
      }
      detail={
        error ? (
          <span className="text-destructive">{error}</span>
        ) : chrome.connected ? (
          "Connected. Bots use tabs of their own, signed in where you are."
        ) : chrome.setUp ? (
          "In Chrome's extensions page, turn on Developer mode, choose Load unpacked and pick the folder OpenBots showed."
        ) : (
          "Lets bots on this server use tabs of their own in your Chrome."
        )
      }
      label="Chrome"
    />
  );
};
