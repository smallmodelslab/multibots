import {
  cloneElement,
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
  type ReactElement,
  type ReactNode,
} from "react";

import { ArrowUpIcon, CloseIcon, PlusIcon, QuoteIcon, StopIcon } from "./icons";
import { outlinePoint, outlineShare } from "./outline";

// Something going out with the message, shown above what is written.
export type ComposerChip = {
  key: string;
  name: string;
  // Said after the name, such as its size.
  detail?: string;
  // An image, shown small before its name, and marked up when clicked if
  // it can be.
  image?: { blob: Blob; onMarkUp?: () => void };
  // Still being read in; the message waits for it.
  pending?: boolean;
  onRemove: () => void;
};

// A passage quoted with the message, shown above what is written and cited
// in it by its marker.
export type ComposerQuote = {
  key: string;
  // Such as "(1)", written where the passage is cited.
  marker: string;
  // Where the marker starts in what is written; none once it is written over.
  at: number | null;
  // The passage, as the app renders it.
  content: ReactNode;
  onRemove: () => void;
};

// Part of some text, from `at`.
export type TextRange = { at: number; length: number };

// `text` with each of `marks` in it drawn on a small card of its own.
export const Marked = ({ text, marks }: { text: string; marks: TextRange[] }) => {
  const parts: ReactNode[] = [];
  let from = 0;
  for (const { at, length } of marks.toSorted((a, b) => a.at - b.at)) {
    parts.push(
      text.slice(from, at),
      <mark className="quote-marker" key={at}>
        {text.slice(at, at + length)}
      </mark>,
    );
    from = at + length;
  }
  parts.push(text.slice(from));
  return parts;
};

// A quoted passage on a card of its own, with its marker, if it has one.
export const QuoteCard = ({
  children,
  marker,
  onRemove,
  renderHint,
}: {
  children: ReactNode;
  marker?: string;
  onRemove?: () => void;
  renderHint?: ComposerProps["renderHint"];
}) => (
  <div className="quote-card">
    <QuoteIcon />
    {marker ? <mark className="quote-marker">{marker}</mark> : null}
    <div className="quote-passage">{children}</div>
    {onRemove ? (
      <Hint label="Remove" render={renderHint}>
        <button
          aria-label={`Remove quote ${marker ?? ""}`.trim()}
          className="icon-button quote-remove"
          onClick={onRemove}
          type="button"
        >
          <CloseIcon />
        </button>
      </Hint>
    ) : null}
  </div>
);

const Thumbnail = ({ blob }: { blob: Blob }) => {
  const source = useCallback(
    (element: HTMLImageElement | null) => {
      if (!element) return;
      const url = URL.createObjectURL(blob);
      element.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [blob],
  );
  return <img alt="" className="attachment-thumbnail" ref={source} />;
};
const Hint = ({
  label,
  children,
  render,
}: {
  label: string;
  children: ReactElement;
  render?: ComposerProps["renderHint"];
}) => (render ? render(label, children) : cloneElement(children, { title: label } as object));

// What writes to an agent, a project or a person. Files and items dragged
// from elsewhere are dropped on the conversation around it, which it
// answers to.
export type ComposerProps = {
  autoFocus?: boolean;
  // Small sits on what it is about, such as a page, rather than under a
  // conversation.
  variant?: "default" | "small";
  leading?: ReactNode;
  trailing?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  renderHint?: (label: string, child: ReactElement) => ReactNode;
  // The app's own spinner for a chip still being read in, kept rendered
  // for every chip so it can finish its turn once `spinning` goes false.
  renderSpinner?: (spinning: boolean) => ReactNode;
  canSend: boolean;
  chips?: ComposerChip[];
  quotes?: ComposerQuote[];
  // Names the field for assistive technology when the placeholder alone
  // would not stay.
  label?: string;
  onSend: () => void;
  // Offered while something runs and the draft is empty or cannot be sent.
  onStop?: (() => void) | null;
  onText: (text: string, event: ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  stopLabel?: string;
  text: string;
  textareaRef?: Ref<HTMLTextAreaElement>;
  // Takes files picked from beside what is written or pasted into it.
  onFiles?: (files: File[]) => void;
  // Apps may offer other attachment types beside the file picker.
  renderAttach?: (openPicker: () => void) => ReactNode;
  // Something is being dragged over the conversation.
  dropping?: boolean;
};

// Aims the composer's focus trace at the point of its outline nearest the
// pointer, wherever the pointer is: the trace starts there, and lights it
// while it waits.
const aimAt = (box: HTMLElement, pointer: { clientX: number; clientY: number }) => {
  const bounds = box.getBoundingClientRect();
  const shape = {
    width: bounds.width,
    height: bounds.height,
    radius: parseFloat(getComputedStyle(box).borderTopLeftRadius),
  };
  const point = {
    x: pointer.clientX - bounds.left,
    y: pointer.clientY - bounds.top,
  };
  const near = outlinePoint(shape, point);
  box.style.setProperty("--trace-from", outlineShare(shape, near).toFixed(2));
  box.style.setProperty("--ready-x", `${near.x.toFixed(1)}px`);
  box.style.setProperty("--ready-y", `${near.y.toFixed(1)}px`);
};

// Pressed into focus, the trace waits, following the pointer round, until
// it is let go. Any box drawn as a composer (`.composer` with
// `ComposerOutline` in it) takes it as its pointer-down.
export const pressAt = (event: PointerEvent<HTMLElement>) => {
  const box = event.currentTarget;
  aimAt(box, event);
  if (box.contains(document.activeElement)) return;
  box.dataset.pressing = "";
  const follow = (move: { clientX: number; clientY: number }) => aimAt(box, move);
  const release = () => {
    delete box.dataset.pressing;
    removeEventListener("pointermove", follow);
    removeEventListener("pointerup", release);
    removeEventListener("pointercancel", release);
  };
  addEventListener("pointermove", follow);
  addEventListener("pointerup", release);
  addEventListener("pointercancel", release);
};

// A quick flash of the composer's outline and shadow as a message goes.
export const flashSent = (box: HTMLElement) => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  box.animate(
    [
      { "--sent": 0, easing: "ease-out" },
      { "--sent": 1, easing: "ease-out", offset: 0.18 },
      { "--sent": 0 },
    ],
    { duration: 480 },
  );
};

// The point a press lights and the outline traced from it.
export const ComposerOutline = () => (
  <>
    <span aria-hidden="true" className="outline-ready" />
    <svg aria-hidden="true" className="outline-trace">
      <rect className="outline-trace-glow" pathLength={100} />
      <rect className="outline-trace-line" pathLength={100} />
    </svg>
  </>
);

const defaultSpinner = (spinning: boolean) =>
  spinning ? <span aria-label="Loading" className="composer-spinner" role="status" /> : null;

// The chips' row opens as the first chip comes and closes once the last
// goes, keeping the last ones shown while it closes. With less motion it
// shuts at once, with no closing to wait for.
const useChipRow = (chips: ComposerChip[]) => {
  const [shown, setShown] = useState(chips);
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (chips.length ? chips !== shown : still && shown.length) setShown(chips);
  return {
    onClosed: () => {
      if (!chips.length) setShown([]);
    },
    open: chips.length > 0,
    shown: chips.length ? chips : shown,
  };
};

const sendOnEnter =
  (send: (from: Element) => void) => (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(event.currentTarget);
    }
  };

// What a paste attaches. A document app copies cells or text with a picture
// of them, and what was meant is the text: it says so with rich text where
// the browser shows it (Safari doesn't). A picture or file copied on its own
// comes with no text, or only its address or name.
const pastedFiles = (data: DataTransfer) => {
  if (data.types.includes("text/rtf")) return [];
  const files = Array.from(data.files);
  const text = data.getData("text/plain").trim();
  if (!text) return files;
  const address = /^(https?|file|data|blob):\S+$/i.test(text);
  const names = new Set(files.map((file) => file.name));
  return address || text.split(/[\r\n]+/).every((line) => names.has(line)) ? files : [];
};

export const Composer = ({ textareaRef, ...props }: ComposerProps) => {
  const { chips = [], onFiles, onStop, quotes = [], text } = props;
  const quiet = !text.trim() && !chips.length && !quotes.length;
  const fileInput = useRef<HTMLInputElement | null>(null);
  const row = useChipRow(chips);
  const spinner = props.renderSpinner ?? defaultSpinner;
  const send = (from: Element) => {
    const box = from.closest<HTMLElement>(".composer");
    if (props.canSend && box) flashSent(box);
    props.onSend();
  };
  return (
    <div className={`composer-wrap${props.variant === "small" ? " is-small" : ""}`}>
      <div
        className={`composer glow${props.dropping ? " is-drop-target" : ""}`}
        onPointerDown={pressAt}
      >
        <ComposerOutline />
        <div
          className={`attachments-row${row.open ? " is-open" : ""}`}
          inert={!row.open}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget) row.onClosed();
          }}
        >
          <div className="attachments-clip">
            <div className="attachments">
              {row.shown.map((chip) => (
                <span className="attachment-chip" key={chip.key}>
                  {spinner(Boolean(chip.pending))}
                  {chip.image?.onMarkUp ? (
                    <Hint label="Mark up" render={props.renderHint}>
                      <button
                        aria-label={`Mark up ${chip.name}`}
                        className="attachment-open"
                        disabled={chip.pending}
                        onClick={chip.image.onMarkUp}
                        type="button"
                      >
                        <Thumbnail blob={chip.image.blob} />
                        <span className="attachment-name">{chip.name}</span>
                      </button>
                    </Hint>
                  ) : (
                    <>
                      {chip.image ? <Thumbnail blob={chip.image.blob} /> : null}
                      <span className="attachment-name">{chip.name}</span>
                    </>
                  )}
                  {chip.detail ? <span className="attachment-size">{chip.detail}</span> : null}
                  <Hint label="Remove" render={props.renderHint}>
                    <button
                      aria-label={`Remove ${chip.name}`}
                      className="icon-button attachment-remove"
                      onClick={chip.onRemove}
                      type="button"
                    >
                      <CloseIcon />
                    </button>
                  </Hint>
                </span>
              ))}
            </div>
          </div>
        </div>
        {quotes.length ? (
          <div className="composer-quotes">
            {quotes.map((quote) => (
              <QuoteCard
                key={quote.key}
                marker={quote.marker}
                onRemove={quote.onRemove}
                renderHint={props.renderHint}
              >
                {quote.content}
              </QuoteCard>
            ))}
          </div>
        ) : null}
        <div className="composer-row">
          {props.leading ? <div className="composer-tools">{props.leading}</div> : null}
          {onFiles ? (
            <div className="composer-tools">
              <input
                className="hidden"
                multiple
                onChange={(event) => {
                  const picked = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  onFiles(picked);
                }}
                ref={fileInput}
                type="file"
              />
              {props.renderAttach ? (
                props.renderAttach(() => fileInput.current?.click())
              ) : (
                <Hint label="Attach files" render={props.renderHint}>
                  <button
                    aria-label="Attach files"
                    className="icon-button composer-attach"
                    onClick={() => fileInput.current?.click()}
                    type="button"
                  >
                    <PlusIcon />
                  </button>
                </Hint>
              )}
            </div>
          ) : null}
          <div className="composer-field">
            {quotes.length ? (
              // What is written, laid out the same behind the field, so each
              // marker in it shows on its card under the field's own text.
              <div
                aria-hidden="true"
                className="composer-marks"
                ref={(marks) => {
                  if (marks)
                    marks.scrollTop = marks.nextElementSibling!.scrollTop;
                }}
              >
                <Marked
                  marks={quotes.flatMap(({ at, marker }) =>
                    at === null ? [] : [{ at, length: marker.length }],
                  )}
                  text={text}
                />
                {"\u200b"}
              </div>
            ) : null}
            <textarea
              aria-label={props.label}
              autoFocus={props.autoFocus}
              onChange={(event) => props.onText(event.currentTarget.value, event)}
              onKeyDown={(event) => {
                props.onKeyDown?.(event);
                if (!event.defaultPrevented) sendOnEnter(send)(event);
              }}
              onPaste={
                onFiles
                  ? (event) => {
                      const files = pastedFiles(event.clipboardData);
                      if (!files.length) return;
                      event.preventDefault();
                      onFiles(files);
                    }
                  : undefined
              }
              onScroll={(event) => {
                const marks = event.currentTarget.previousElementSibling;
                if (marks) marks.scrollTop = event.currentTarget.scrollTop;
              }}
              placeholder={props.placeholder}
              ref={textareaRef}
              rows={1}
              value={text}
            />
          </div>
          <div className="composer-tools">
            {props.trailing}
            {onStop && (quiet || !props.canSend) ? (
              <button
                aria-label={props.stopLabel ?? "Stop"}
                className="send-button glow"
                onClick={onStop}
                type="button"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                aria-label="Send"
                className="send-button glow"
                disabled={!props.canSend}
                onClick={(event) => send(event.currentTarget)}
                type="button"
              >
                <ArrowUpIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
