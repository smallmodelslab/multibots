import { useId, useState } from "react";

import type { MultidesktopState } from "../../shared/types";
import { bridge, messageOf } from "../data";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { SettingRow } from "./SettingRow";

// This server's Multidesktop, through which its bots see and use its
// screen: installed here when it is missing or too old. Signed in to
// Multidesktop's cloud, it also lets them use the user's other computers.
export const MultidesktopSetting = ({
  multidesktop: { computers, current, installing, signingIn, usable, version },
}: {
  multidesktop: MultidesktopState;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const install = () => {
    setError(null);
    bridge
      .installMultidesktop()
      .catch((failure: unknown) => setError(messageOf(failure)));
  };
  const signIn = () => {
    setSignInError(null);
    bridge
      .signInMultidesktop()
      .catch((failure: unknown) => setSignInError(messageOf(failure)));
  };
  const windows = bridge.platform === "win32";
  const detailId = useId();
  return (
    <>
      <SettingRow
        action={
          installing ? (
            <span className="login-wait">
              <Spinner className="size-3" />
              Installing
            </span>
          ) : current ? null : (
            <Button
              aria-describedby={windows ? detailId : undefined}
              disabled={windows}
              focusableWhenDisabled
              onClick={install}
              size="sm"
            >
              {error ? "Try again" : version ? "Update" : "Install"}
            </Button>
          )
        }
        detail={
          windows ? (
            "Bots can't use the screen on Windows yet."
          ) : error ? (
            <span className="text-destructive">{error}</span>
          ) : version && current ? (
            `Version ${version}`
          ) : version && usable ? (
            `Version ${version}; 0.4.8 lets bots ${bridge.platform === "darwin" ? "read text on the screen" : "see part of the screen up close"}.`
          ) : version ? (
            `Version ${version}; bots need 0.4.7 or newer to use the screen.`
          ) : (
            "Lets bots on this server see and use its screen."
          )
        }
        detailId={detailId}
        label="Multidesktop"
      />
      {version ? (
        <SettingRow
          action={
            signingIn ? (
              <span className="login-wait">
                <Spinner className="size-3" />
                Signing in
              </span>
            ) : computers === null ? (
              <Button onClick={signIn} size="sm">
                Sign in
              </Button>
            ) : null
          }
          detail={
            signInError ? (
              <span className="text-destructive">{signInError}</span>
            ) : computers === null ? (
              "Sign in to Multidesktop so bots can use your other computers."
            ) : computers.length ? (
              computers.join(", ")
            ) : (
              "None of your other computers is on Multidesktop."
            )
          }
          label="Other computers"
        />
      ) : null}
    </>
  );
};
