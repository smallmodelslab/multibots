import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";

import { bytes, cn } from "@/lib/utils";
import {
  uploadLimits,
  type Attachment,
  type Bot,
  type BotDetail,
  type Host,
  type Message,
  type Upload,
} from "../../shared/types";
import {
  botKey,
  bridge,
  call,
  messageOf,
  patch,
  refresh,
  useAppState,
  useBotDetail,
} from "../data";
import { ChatHead } from "../messages/ChatHead";
import { previewOf } from "../../shared/preview";
import { Markdown } from "../messages/Markdown";
import {
  ForwardedBlock,
  MessageActions,
  QuoteBlock,
  Reactions,
  textOf,
} from "../messages/MessageActions";
import {
  MessageGroup,
  StretchTime,
  stretchGapMs,
} from "../messages/MessageGroup";
import { Composer } from "../shell/Composer";
import { Hint } from "../shell/Hint";
import {
  HangUpIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  PaperclipIcon,
  VoiceIcon,
} from "../shell/icons";
import { toastError } from "../shell/Toasts";
import { BotAvatar } from "./BotAvatar";
import { botColor } from "./colors";
import { cue, useAvatarListening, useAvatarTalking } from "./avatars";
import {
  endVoiceChat,
  muteVoiceChat,
  startVoiceChat,
  useVoiceChat,
  type VoiceChat,
} from "./voiceChat";

// What the user had written to each bot and not yet sent, and the message
// it replies to or edits, kept for the window's session so that leaving
// the conversation or reloading into an update keeps them.
const keep = (key: string, value: string) =>
  value ? sessionStorage.setItem(key, value) : sessionStorage.removeItem(key);

type Draft = { mode: "reply" | "edit"; message: Message } | null;

const upload = (file: File) =>
  new Promise<Upload>((done, fail) => {
    const reader = new FileReader();
    reader.onload = () =>
      done({
        data: String(reader.result).slice(
          String(reader.result).indexOf(",") + 1,
        ),
        name: file.name,
        type: file.type,
      });
    reader.onerror = () => fail(reader.error);
    reader.readAsDataURL(file);
  });

// A file the user sent, as a card that opens it from the bot's folder.
const SentFile = ({ bot, file }: { bot: Bot; file: Attachment }) => (
  <button
    className="context-card sent-file glow"
    disabled={!file.path}
    onClick={() =>
      bridge
        .openFile(bot.id, file.path)
        .catch((error: unknown) => toastError(messageOf(error)))
    }
    type="button"
  >
    <span aria-hidden="true" className="context-icon">
      <PaperclipIcon />
    </span>
    <span className="sent-file-name">{file.name}</span>
    <span className="sent-file-size">{bytes(file.size)}</span>
  </button>
);

// What the composer shows of the message replied to or edited.
const excerpt = (text: string) =>
  text.length > 80 ? `${text.slice(0, 80)}…` : text;

// When a message was sent, beside it while it is hovered.
const Sent = ({ at }: { at: number }) => (
  <time className="message-time" dateTime={new Date(at).toISOString()}>
    {new Date(at).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    })}
  </time>
);

// Who wrote a message, by its role.
type AuthorOf = (role: Message["role"]) => string;

const Bubble = ({
  authorOf,
  bot,
  message,
  onEdit,
  onReply,
}: {
  authorOf: AuthorOf;
  bot: Bot;
  message: Message;
  onEdit: () => void;
  onReply: () => void;
}) => {
  const mine = message.role === "user";
  const bubble = mine ? (
    <div className="user-bubble">
      {message.replyTo ? (
        <QuoteBlock
          author={authorOf(message.replyTo.role)}
          quote={message.replyTo}
        />
      ) : null}
      {message.attachments?.map((file) => (
        <SentFile bot={bot} file={file} key={file.path || file.name} />
      ))}
      {message.text}
      {message.forwarded ? (
        <ForwardedBlock forwarded={message.forwarded} />
      ) : null}
    </div>
  ) : (
    <div
      className={cn(
        "agent-bubble",
        message.role === "error" && "text-[var(--red)]",
      )}
    >
      <Markdown text={message.text} />
    </div>
  );
  // One still on its way to the bot's computer has nothing to act on yet.
  const acted = message.id.startsWith("pending-") ? (
    bubble
  ) : (
    <MessageActions
      author={authorOf(message.role)}
      bot={bot}
      className={cn(
        "flex min-w-0 flex-col",
        mine ? "max-w-[80%] items-end" : "max-w-[88%] items-start",
      )}
      message={message}
      onEdit={onEdit}
      onReply={onReply}
      side={mine ? "start" : "end"}
    >
      {bubble}
      <Reactions align={mine ? "end" : "start"} bot={bot} message={message} />
    </MessageActions>
  );
  return mine ? (
    <div className="message flex flex-col items-end">
      <div className="flex w-full items-end justify-end gap-2">
        <Sent at={message.at} />
        {acted}
      </div>
      {message.edited ? <span className="message-note">Edited</span> : null}
    </div>
  ) : (
    <div className="message flex items-end gap-2">
      {acted}
      <Sent at={message.at} />
    </div>
  );
};

// The voice chat's controls in the composer: one to start it, then ones to
// mute and to hang up.
const VoiceControls = ({
  bot,
  chat,
  voice,
}: {
  bot: Bot;
  chat: VoiceChat | null;
  // What its computer's voice chats run on, when its bots can answer.
  voice: NonNullable<Host["voice"]>["kind"] | null;
}) =>
  chat ? (
    <>
      <Hint label={chat.muted ? "Unmute" : "Mute"}>
        <button
          aria-label={chat.muted ? "Unmute" : "Mute"}
          className="icon-button"
          onClick={() => muteVoiceChat(!chat.muted)}
          type="button"
        >
          {chat.muted ? <MicrophoneOffIcon /> : <MicrophoneIcon />}
        </button>
      </Hint>
      <Hint label="Hang up">
        <button
          aria-label="Hang up"
          className="icon-button voice-hang-up"
          onClick={endVoiceChat}
          type="button"
        >
          <HangUpIcon />
        </button>
      </Hint>
    </>
  ) : (
    <Hint label="Start voice chat">
      <button
        aria-label="Start voice chat"
        className="icon-button"
        disabled={!voice}
        onClick={() => voice && void startVoiceChat(bot, voice)}
        type="button"
      >
        <VoiceIcon />
      </button>
    </Hint>
  );

// Keeps a chat at its newest message while the reader is there, whatever
// makes it taller, and opens each chat at its end.
const useStickToEnd = (key: string) => {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  useEffect(() => {
    const element = scroller.current!;
    atEnd.current = true;
    element.scrollTop = element.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (atEnd.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(content.current!);
    return () => observer.disconnect();
  }, [key]);
  const onScroll = () => {
    const element = scroller.current!;
    atEnd.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  };
  return { content, onScroll, scroller };
};

// A bot's conversation: the bot floating over its top, opening its details,
// its messages, and the composer.
export const Conversation = ({
  bot,
  host,
  onOpenDetails,
  onSettings,
}: {
  bot: Bot;
  host: Host | undefined;
  onOpenDetails: () => void;
  onSettings: () => void;
}) => {
  const { id } = bot;
  const detail = useBotDetail(bot.id);
  const user = useAppState()?.user ?? "You";
  const authorOf: AuthorOf = (role) => (role === "user" ? user : bot.name);
  const [text, setTextState] = useState(
    () => sessionStorage.getItem(`openbots.draft.${id}`) ?? "",
  );
  const setText = (next: string) => {
    keep(`openbots.draft.${id}`, next);
    setTextState(next);
  };
  // Replying to a message, or editing one of the user's own, puts the caret
  // in the composer.
  const [draft, setDraftState] = useState<Draft>(() =>
    JSON.parse(sessionStorage.getItem(`openbots.replying.${id}`) ?? "null"),
  );
  const setDraft = (next: Draft) => {
    keep(`openbots.replying.${id}`, next ? JSON.stringify(next) : "");
    setDraftState(next);
  };
  const textarea = useRef<HTMLTextAreaElement>(null);
  const writeOn = () =>
    requestAnimationFrame(() => {
      const field = textarea.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
  const clearDraft = () => {
    if (draft?.mode === "edit") setText("");
    setDraft(null);
  };
  // Files picked, pasted or dropped, going out with the next message.
  const [files, setFiles] = useState<File[]>([]);
  const [dropping, setDropping] = useState(false);
  const addFiles = (picked: File[]) => {
    const fitting = picked.filter((file) => {
      if (file.size <= uploadLimits.bytes) return true;
      toastError(`${file.name} is larger than 25 MB.`);
      return false;
    });
    setFiles((current) => {
      const next = [...current, ...fitting];
      if (next.length > uploadLimits.count)
        toastError(`A message carries at most ${uploadLimits.count} files.`);
      return next.slice(0, uploadLimits.count);
    });
  };
  const working = Boolean(bot.working);
  const voice = useVoiceChat();
  const chat = voice?.botId === bot.id ? voice : null;
  // The voice chat lives in the conversation: leaving it hangs up.
  useEffect(() => endVoiceChat, []);
  useAvatarListening(bot.id, Boolean(text.trim()) || files.length > 0);
  useAvatarTalking(bot, working || Boolean(chat?.speaking));
  const { content, onScroll, scroller } = useStickToEnd(id);

  const send = () => {
    const body = text.trim();
    if (draft?.mode === "edit") {
      const edited = draft;
      if (!body) return;
      setText("");
      setDraft(null);
      call({
        botId: bot.id,
        messageId: edited.message.id,
        text: body,
        type: "message.edit",
      }).catch((error: unknown) => {
        setText(body);
        setDraft(edited);
        toastError(messageOf(error));
      });
      return;
    }
    const sending = files;
    if (!body && !sending.length) return;
    const replied = draft?.message;
    setText("");
    setFiles([]);
    setDraft(null);
    cue(bot.id, "told");
    const pending: Message = {
      at: Date.now(),
      id: `pending-${Date.now()}`,
      role: "user",
      text: body,
      ...(replied
        ? {
            replyTo: {
              messageId: replied.id,
              role: replied.role,
              text: textOf(replied),
            },
          }
        : {}),
      ...(sending.length
        ? {
            attachments: sending.map((file) => ({
              name: file.name,
              path: "",
              size: file.size,
              type: file.type,
            })),
          }
        : {}),
    };
    patch<BotDetail | null>(botKey(bot.id), (current) =>
      current
        ? { ...current, messages: [...current.messages, pending] }
        : current,
    );
    Promise.all(sending.map(upload))
      .then((uploads) =>
        call({
          botId: bot.id,
          replyTo: replied?.id,
          text: body,
          type: "bot.send",
          uploads,
        }),
      )
      .catch((error: unknown) => {
        refresh(botKey(bot.id));
        setText(body);
        setFiles(sending);
        if (replied) setDraft({ message: replied, mode: "reply" });
        toastError(messageOf(error));
      });
  };
  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropping(true);
  };
  const onDragLeave = (event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
      setDropping(false);
  };
  const onDrop = (event: DragEvent) => {
    setDropping(false);
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files));
  };

  const messages = detail?.messages ?? [];
  const entries = messages.map((message, index) => ({
    at: message.at,
    message,
    sender: message.role === "user" ? "user" : "bot",
    stamp: message.at - (messages[index - 1]?.at ?? 0) > stretchGapMs,
  }));
  const offline = host && !host.model;

  return (
    <section
      className="pane bot-conversation"
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={
        {
          "--bot-color": botColor(bot.hue),
          "--bot-hue": bot.hue,
        } as CSSProperties
      }
    >
      <Hint label={`${bot.name}'s details`} side="bottom">
        <button
          aria-label={`${bot.name}'s details`}
          className="profile-float"
          onClick={onOpenDetails}
          type="button"
        >
          <ChatHead
            avatar={<BotAvatar bot={bot} size={40} />}
            name={bot.name}
            opens
          />
        </button>
      </Hint>
      <div
        className="conversation-scroll is-below-profile min-h-0 flex-1 overflow-y-auto"
        onScroll={onScroll}
        ref={scroller}
      >
        <div
          className="mx-auto flex max-w-[760px] flex-col gap-2.5 px-6 pt-(--head-room) pb-6 select-text"
          ref={content}
        >
          {detail && !entries.length ? (
            <div className="pt-24 text-center text-muted-foreground">
              Say hello to {bot.name}.
            </div>
          ) : null}
          {entries.map((entry, index) => (
            <div className="contents" key={entry.message.id}>
              {entry.stamp ? <StretchTime at={entry.at} /> : null}
              <MessageGroup
                message={entry}
                next={entries[index + 1]}
                previous={entries[index - 1]}
                side={entry.sender === "user" ? "end" : "start"}
              >
                <Bubble
                  authorOf={authorOf}
                  bot={bot}
                  message={entry.message}
                  onEdit={() => {
                    setDraft({ message: entry.message, mode: "edit" });
                    setText(entry.message.text);
                    writeOn();
                  }}
                  onReply={() => {
                    setDraft({ message: entry.message, mode: "reply" });
                    writeOn();
                  }}
                />
              </MessageGroup>
            </div>
          ))}
          {working ? (
            <div className="message flex items-end gap-2">
              <Hint label={bot.working ?? ""}>
                <div
                  aria-label={`${bot.name} is working`}
                  className="agent-bubble typing"
                  role="status"
                >
                  <span />
                  <span />
                  <span />
                </div>
              </Hint>
            </div>
          ) : null}
        </div>
      </div>
      {offline ? (
        <p className="conversation-notice">
          {host.self ? (
            <button onClick={onSettings} type="button">
              Sign in to ChatGPT
            </button>
          ) : (
            `Sign in to ChatGPT on ${host.name}`
          )}{" "}
          so {bot.name} can answer.
        </p>
      ) : null}
      <Composer
        autoFocus
        canSend={
          Boolean(text.trim()) || (draft?.mode !== "edit" && files.length > 0)
        }
        chips={[
          ...(draft
            ? [
                {
                  detail: excerpt(previewOf(textOf(draft.message))),
                  key: `${draft.mode}:${draft.message.id}`,
                  name:
                    draft.mode === "reply"
                      ? `Replying to ${authorOf(draft.message.role)}`
                      : "Editing",
                  onRemove: clearDraft,
                },
              ]
            : []),
          ...files.map((file, index) => ({
            detail: bytes(file.size),
            image: file.type.startsWith("image/") ? { blob: file } : undefined,
            key: `${index}:${file.name}`,
            name: file.name,
            onRemove: () =>
              setFiles((current) => current.filter((other) => other !== file)),
          })),
        ]}
        dropping={dropping}
        label={`Message ${bot.name}`}
        onFiles={addFiles}
        onSend={send}
        onStop={
          working
            ? () => {
                cue(bot.id, "stopped");
                call({ botId: bot.id, type: "bot.stop" }).catch(
                  (error: unknown) => toastError(messageOf(error)),
                );
              }
            : null
        }
        onText={setText}
        placeholder={
          chat
            ? chat.live
              ? `Talking with ${bot.name}`
              : "Connecting…"
            : `Message ${bot.name}`
        }
        stopLabel={`Stop ${bot.name}`}
        text={text}
        textareaRef={textarea}
        trailing={
          <VoiceControls
            bot={bot}
            chat={chat}
            voice={(host?.model && host.voice?.kind) || null}
          />
        }
      />
    </section>
  );
};
