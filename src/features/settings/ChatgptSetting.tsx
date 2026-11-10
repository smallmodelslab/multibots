import { Check, Copy } from "lucide-react";
import { useState } from "react";

import type { ChatgptState } from "../../shared/types";
import { bridge, messageOf } from "../data";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { SettingRow } from "./SettingRow";

// The code to enter at OpenAI, once there is one.
const DeviceCode = ({ pending }: { pending: ChatgptState["pending"] }) => {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1 pb-3">
      {pending ? (
        <>
          <span className="text-muted-foreground">
            Enter this code at{" "}
            <a
              className="text-[var(--link)] no-underline hover:underline"
              href={pending.url}
              rel="noreferrer"
              target="_blank"
            >
              {pending.url.replace(/^https:\/\//, "")}
            </a>
          </span>
          <div className="flex items-center gap-2">
            <span className="device-code select-all">{pending.code}</span>
            <Button
              aria-label="Copy code to clipboard"
              className="w-20"
              onClick={() =>
                void navigator.clipboard
                  .writeText(pending.code)
                  .then(() => setCopied(pending.code))
              }
              size="sm"
              variant="ghost"
            >
              {copied === pending.code ? (
                <Check aria-hidden />
              ) : (
                <Copy aria-hidden />
              )}
              <span aria-live="polite">
                {copied === pending.code ? "Copied" : "Copy"}
              </span>
            </Button>
          </div>
        </>
      ) : null}
      <span className="login-wait">
        <Spinner className="size-3" />
        {pending ? "Waiting for the code" : "Getting a code"}
      </span>
    </div>
  );
};

// The ChatGPT account this computer's bots and voice chats run on, with
// what it does for the setting it is shown in (`note`). Signing in shows a
// code to enter at OpenAI, and finishes by itself once it is entered.
export const ChatgptSetting = ({
  chatgpt,
  note,
}: {
  chatgpt: ChatgptState;
  note: string;
}) => {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = starting || Boolean(chatgpt.pending);
  const signIn = () => {
    setError(null);
    setStarting(true);
    bridge
      .signIn()
      .catch((failure: unknown) => setError(messageOf(failure)))
      .finally(() => setStarting(false));
  };
  return (
    <SettingRow
      action={
        chatgpt.signedIn || waiting ? (
          <Button
            onClick={() => {
              setStarting(false);
              void bridge.signOut();
            }}
            size="sm"
            variant="ghost"
          >
            {chatgpt.signedIn && !waiting ? "Sign out" : "Cancel"}
          </Button>
        ) : (
          <Button onClick={signIn} size="sm">
            {error ? "Try again" : "Sign in"}
          </Button>
        )
      }
      detail={
        error ? (
          <span className="text-destructive">{error}</span>
        ) : chatgpt.signedIn ? (
          (chatgpt.email ?? "Signed in")
        ) : (
          note
        )
      }
      label="Account"
    >
      {waiting ? <DeviceCode pending={chatgpt.pending} /> : null}
    </SettingRow>
  );
};
