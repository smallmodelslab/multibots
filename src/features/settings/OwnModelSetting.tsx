import { Plus } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  defaultContextWindow,
  type OwnModel,
  type OwnModelKind,
  type OwnModelsState,
} from "../../shared/types";
import { bridge, messageOf } from "../data";
import { Hint } from "../shell/Hint";
import { CloseIcon } from "../shell/icons";
import { toastError } from "../shell/Toasts";
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
} from "../ui/autocomplete";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Spinner } from "../ui/spinner";

// The models the user hosts behind an OpenAI-style API, for chat or a
// voice chat's transcription or speech. Adding one opens its use, address,
// model and key, and a chat model's context window, in place of the add
// row, and Multibots checks the server answers before keeping it; Cancel
// stops that check.

const uses: OwnModelKind[] = ["bots", "transcription", "speech"];

export const useOf: Record<OwnModelKind, string> = {
  bots: "Chat",
  speech: "Speech",
  transcription: "Transcription",
};

export const hostOf = (address: string) => {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
};

type Served = Awaited<ReturnType<typeof bridge.servedModels>>;

// The models the server lists, once an address is entered, for the model
// and context window fields to suggest.
const useServedModels = (address: string, key: string) => {
  // What the server listed, for the address and key it was asked with.
  const [listed, setListed] = useState({ asked: "", models: [] as Served });
  const asked = `${address}\n${key}`;
  useEffect(() => {
    if (!address.trim()) return;
    let current = true;
    const timer = setTimeout(
      () =>
        void bridge.servedModels(address, key).then(
          (models) => current && setListed({ asked, models }),
          () => current && setListed({ asked, models: [] }),
        ),
      500,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [address, asked, key]);
  return listed.asked === asked ? listed.models : [];
};

const Field = ({
  children,
  id,
  label,
}: {
  children: ReactNode;
  id: string;
  label: string;
}) => (
  <div className="setting-row">
    <label className="setting-label" htmlFor={id}>
      {label}
    </label>
    <div className="setting-detail">{children}</div>
  </div>
);

const ConnectForm = ({ onClose }: { onClose: () => void }) => {
  const ids = {
    address: useId(),
    key: useId(),
    model: useId(),
    use: useId(),
    window: useId(),
  };
  const problemId = useId();
  const [kind, setKind] = useState(uses[0]!);
  const [address, setAddress] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [contextWindow, setContextWindow] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The check under way, which Cancel stops; it takes the focus meanwhile,
  // as the fields go disabled, so Escape still reaches the form.
  const attempt = useRef<string | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const served = useServedModels(address, key);
  const models = served.map(({ id }) => id);
  const reported = served.find(
    ({ id }) => id === (model.trim() || models[0]),
  )?.contextWindow;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !address.trim()) return;
    const checking = crypto.randomUUID();
    attempt.current = checking;
    setBusy(true);
    cancelButton.current?.focus();
    setProblem(null);
    bridge
      .connectModel(
        kind,
        { address, key, model, window: contextWindow },
        checking,
      )
      .then(
        (id) => {
          // Kept after Cancel came too late to stop it: removed again.
          if (attempt.current === checking) onClose();
          else void bridge.disconnectModel(id);
        },
        (error) => {
          if (attempt.current !== checking) return;
          attempt.current = null;
          setBusy(false);
          setProblem(messageOf(error));
        },
      );
  };
  const cancel = () => {
    if (attempt.current) void bridge.cancelConnectModel(attempt.current);
    attempt.current = null;
    onClose();
  };
  return (
    <form
      aria-describedby={problem ? problemId : undefined}
      className="pb-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
      }}
      onSubmit={submit}
    >
      <Field id={ids.use} label="Use for">
        <Select
          disabled={busy}
          onValueChange={(next) => next && setKind(next)}
          value={kind}
        >
          <SelectTrigger id={ids.use} size="sm">
            <SelectValue>
              {(current: OwnModelKind) => useOf[current]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {uses.map((each) => (
              <SelectItem key={each} value={each}>
                {useOf[each]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id={ids.address} label="Address">
        <Input
          autoFocus
          disabled={busy}
          id={ids.address}
          onChange={(event) => {
            setAddress(event.currentTarget.value);
            setProblem(null);
          }}
          placeholder="http://localhost:8000/v1"
          spellCheck={false}
          value={address}
        />
      </Field>
      <Field id={ids.model} label="Model">
        <Autocomplete
          items={models}
          onValueChange={(next) => {
            setModel(next);
            setProblem(null);
          }}
          openOnInputClick
          value={model}
        >
          <AutocompleteInput
            disabled={busy}
            id={ids.model}
            placeholder={models[0] ?? "The server's first model"}
            spellCheck={false}
          />
          <AutocompleteContent>
            {(item: string) => (
              <AutocompleteItem key={item} value={item}>
                {item}
              </AutocompleteItem>
            )}
          </AutocompleteContent>
        </Autocomplete>
      </Field>
      <Field id={ids.key} label="Key">
        <Input
          autoComplete="off"
          disabled={busy}
          id={ids.key}
          onChange={(event) => {
            setKey(event.currentTarget.value);
            setProblem(null);
          }}
          placeholder="Optional"
          type="password"
          value={key}
        />
      </Field>
      {kind === "bots" ? (
        <Field id={ids.window} label="Context window">
          <Input
            autoComplete="off"
            disabled={busy}
            id={ids.window}
            inputMode="numeric"
            onChange={(event) => {
              setContextWindow(event.currentTarget.value);
              setProblem(null);
            }}
            placeholder={
              reported
                ? `${reported.toLocaleString()} tokens, as the server says`
                : `${defaultContextWindow.toLocaleString()} tokens unless the server says`
            }
            spellCheck={false}
            value={contextWindow}
          />
        </Field>
      ) : null}
      {problem ? (
        <p className="m-0 pb-2 text-destructive" id={problemId} role="alert">
          {problem}
        </p>
      ) : null}
      <div className="flex justify-end gap-1.5">
        <Button
          onClick={cancel}
          ref={cancelButton}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button disabled={busy || !address.trim()} size="sm" type="submit">
          <Spinner spinning={busy} />
          Save
        </Button>
      </div>
    </form>
  );
};

const ModelRow = ({ hint, model }: { hint?: string; model: OwnModel }) => (
  <div className="setting hover-actions">
    <div className="setting-row">
      <div className="setting-label">{useOf[model.kind]}</div>
      <div className="setting-detail">
        {model.model} · {hostOf(model.address)}
        {hint ? <div className="text-muted-foreground">{hint}</div> : null}
      </div>
      <div className="setting-action">
        <Hint label="Remove">
          <button
            aria-label={`Remove ${model.model}`}
            className="icon-button hover-action"
            onClick={() =>
              void bridge
                .disconnectModel(model.id)
                .catch((error: unknown) => toastError(messageOf(error)))
            }
            type="button"
          >
            <CloseIcon />
          </button>
        </Hint>
      </div>
    </div>
  </div>
);

// A voice chat on the user's models needs one of each kind.
const missing = {
  speech: "transcription",
  transcription: "speech",
} as const;

export const OwnModelSettings = ({
  entries,
}: {
  entries: OwnModelsState[keyof OwnModelsState];
}) => {
  const [adding, setAdding] = useState(false);
  const models = entries.filter((entry) => entry !== "chatgpt");
  return (
    <>
      {models.map((model) => {
        const other = model.kind === "bots" ? null : missing[model.kind];
        return (
          <ModelRow
            hint={
              other && !models.some((each) => each.kind === other)
                ? `Voice chats need a ${other} model too.`
                : undefined
            }
            key={model.id}
            model={model}
          />
        );
      })}
      <div className="setting">
        {adding ? (
          <ConnectForm onClose={() => setAdding(false)} />
        ) : (
          <div className="setting-row">
            <Button
              className="-ml-2.5 justify-self-start text-muted-foreground"
              onClick={() => setAdding(true)}
              size="sm"
              variant="ghost"
            >
              <Plus aria-hidden />
              Add model
            </Button>
            {models.length ? null : (
              <div className="setting-detail text-muted-foreground">
                Models you host behind an OpenAI-style API, such as vLLM, Ollama
                or LM Studio.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};
