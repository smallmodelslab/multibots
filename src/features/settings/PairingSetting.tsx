import { Check, Copy } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { PairingState } from "../../shared/types";
import { bridge, messageOf } from "../data";
import { Button } from "../ui/button";
import { confirm } from "../ui/confirm";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { SettingRow } from "./SettingRow";

// The code this computer shares with the user's other computers and phone:
// only those holding the same one reach each other's bots. Changing it takes
// another computer's code, or makes a new one, which cuts off the rest until
// they are given it.
export const PairingSetting = ({ pairing }: { pairing: PairingState }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pair = (code: string | null) => {
    setBusy(true);
    setProblem(null);
    bridge
      .pair(code)
      .then(
        () => {
          setChanging(false);
          setTyped("");
        },
        (error: unknown) => setProblem(messageOf(error)),
      )
      .finally(() => setBusy(false));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy && typed.trim()) pair(typed);
  };
  const renew = async () => {
    if (
      await confirm({
        action: "Make new code",
        detail:
          "Your other computers and phone lose this computer's bots until you give them the new code.",
        title: "Make a new pairing code?",
      })
    )
      pair(null);
  };
  return (
    <>
      {pairing.unpaired.map((name) => (
        <SettingRow
          detail={`${name} has another pairing code`}
          key={name}
          label="Not paired"
        />
      ))}
      <SettingRow
        action={
          changing ? (
            <Button
              onClick={() => {
                setChanging(false);
                setProblem(null);
              }}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
          ) : (
            <>
              <Button
                aria-label="Copy pairing code"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(pairing.code)
                    .then(() => setCopied(pairing.code))
                }
                size="sm"
                variant="ghost"
              >
                {copied === pairing.code ? (
                  <Check aria-hidden />
                ) : (
                  <Copy aria-hidden />
                )}
                <span aria-live="polite">
                  {copied === pairing.code ? "Copied" : "Copy"}
                </span>
              </Button>
              <Button
                onClick={() => setChanging(true)}
                size="sm"
                variant="ghost"
              >
                Change
              </Button>
            </>
          )
        }
        detail={<span className="select-all">{pairing.code}</span>}
        label="Pairing code"
        mono
      >
        {changing ? (
          <form className="flex flex-col gap-2 pb-3" onSubmit={submit}>
            <div className="flex items-center gap-2">
              <Input
                aria-label="Another computer's pairing code"
                autoComplete="off"
                autoFocus
                disabled={busy}
                onChange={(event) => {
                  setTyped(event.currentTarget.value);
                  setProblem(null);
                }}
                placeholder="The code in Settings on your other computer"
                value={typed}
              />
              <Button disabled={busy || !typed.trim()} size="sm" type="submit">
                <Spinner spinning={busy} />
                Pair
              </Button>
            </div>
            <p className="m-0 text-muted-foreground">
              {problem ? (
                <span className="text-destructive" role="alert">
                  {problem}
                </span>
              ) : (
                <>
                  Or{" "}
                  <Button
                    className="h-auto p-0"
                    disabled={busy}
                    onClick={() => void renew()}
                    type="button"
                    variant="link"
                  >
                    make a new code
                  </Button>
                  , which cuts off your other computers and phone until you give
                  it to them.
                </>
              )}
            </p>
          </form>
        ) : null}
      </SettingRow>
    </>
  );
};
