import { useState } from "react";

import type { MultidesktopState } from "../../shared/types";
import { bridge, messageOf } from "../data";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { SettingRow } from "./SettingRow";

// This server's Multidesktop, through which its bots see and use its
// screen: installed here when it is missing or too old. Signed in to
// Multidesktop's cloud, it also lets them use the user's other computers.
export const MultidesktopSetting = ({
  multidesktop: { computers, current, installing, signingIn, version },
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
            <Button onClick={install} size="sm">
              {error ? "Try again" : version ? "Update" : "Install"}
            </Button>
          )
        }
        detail={
          error ? (
            <span className="text-destructive">{error}</span>
          ) : version && current ? (
            `Version ${version}`
          ) : version ? (
            `Version ${version}; bots need 0.4.7 or newer to use the screen.`
          ) : (
            "Lets bots on this server see and use its screen."
          )
        }
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
