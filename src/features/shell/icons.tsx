export {
  ArrowUpIcon,
  CloseIcon,
  PlusIcon,
  StopIcon,
} from "@wrkrsh/composer/icons";
import type { ReactNode } from "react";

const Icon = ({ children }: { children: ReactNode }) => (
  <svg
    aria-hidden="true"
    className="icon"
    fill="none"
    height="16"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
    viewBox="0 0 16 16"
    width="16"
  >
    {children}
  </svg>
);

export const SidebarIcon = () => (
  <Icon>
    <rect height="10.5" rx="2" width="12" x="2" y="2.75" />
    <path d="M6.25 2.75v10.5" />
  </Icon>
);

// Editing: a pencil.
export const PencilIcon = () => (
  <Icon>
    <path d="M10.6 2.9a1.6 1.6 0 0 1 2.3 2.3l-7.4 7.4-3 .8.8-3z" />
    <path d="M9.4 4.1l2.3 2.3" />
  </Icon>
);

export const FolderIcon = () => (
  <Icon>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6a1.5 1.5 0 0 1 1.06.44L8.3 4.5h4.2A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4 4.5l.7 8.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8l.7-8.2" />
    <path d="M6.7 7v4M9.3 7v4" />
  </Icon>
);

// A drawn line, for the whiteboard.
export const DrawIcon = () => (
  <Icon>
    <path d="M2.5 11.5c1.5-2.5 2.6-6 4.2-6 1.7 0-.4 5.2 1.4 5.2 1.4 0 2.2-3.4 3.6-3.4 1 0 1 1.6 1.8 2.2" />
  </Icon>
);

export const FileIcon = () => (
  <Icon>
    <path d="M4 2.5h5l3 3v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1z" />
    <path d="M9 2.5v3h3" />
  </Icon>
);

export const PaperclipIcon = () => (
  <Icon>
    <path d="M10.5 4.5L5.9 9.1a1.6 1.6 0 0 0 2.3 2.3l5-5a3 3 0 0 0-4.3-4.3L3.6 7.4a4.2 4.2 0 0 0 6 6l3-3" />
  </Icon>
);

export const ChevronLeftIcon = () => (
  <Icon>
    <path d="M10 3.5L5.5 8l4.5 4.5" />
  </Icon>
);

export const ChevronRightIcon = () => (
  <Icon>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </Icon>
);

export const ExternalIcon = () => (
  <Icon>
    <path d="M6.5 3.5H4a1 1 0 0 0-1 1V12a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V9.5" />
    <path d="M9.5 3H13v3.5M13 3L8 8" />
  </Icon>
);

export const TerminalIcon = () => (
  <Icon>
    <rect height="10.5" rx="2" width="12" x="2" y="2.75" />
    <path d="M5 6.5 6.75 8 5 9.5M8.25 10h2.75" />
  </Icon>
);

// Talking out loud: a voice's waves.
export const VoiceIcon = () => (
  <Icon>
    <path d="M2.75 6.75v2.5M5.25 4.5v7M7.75 2.75v10.5M10.25 5.25v5.5M12.75 7v2" />
  </Icon>
);

export const MicrophoneIcon = () => (
  <Icon>
    <rect height="7.5" rx="2.25" width="4.5" x="5.75" y="2" />
    <path d="M3.75 7.75a4.25 4.25 0 0 0 8.5 0M8 12v2" />
  </Icon>
);

export const MicrophoneOffIcon = () => (
  <Icon>
    <path d="M10.25 6.5V4.25a2.25 2.25 0 0 0-4.43-.56M5.75 6.25v1.5a2.25 2.25 0 0 0 3.6 1.8" />
    <path d="M3.75 7.75a4.25 4.25 0 0 0 7.3 2.95M8 12v2M2.5 2.5l11 11" />
  </Icon>
);

// Ending a call: the handset put down.
export const HangUpIcon = () => (
  <Icon>
    <path d="M2.4 9.6c-.5-.5-.5-1.3.1-1.8C4.1 6.5 6 5.9 8 5.9s3.9.6 5.5 1.9c.6.5.6 1.3.1 1.8l-1 1a.9.9 0 0 1-1.1.1l-1.4-.9a.9.9 0 0 1-.4-.8V7.7a7 7 0 0 0-3.4 0V9c0 .3-.2.6-.4.8l-1.4.9a.9.9 0 0 1-1.1-.1z" />
  </Icon>
);

export const ReplyIcon = () => (
  <Icon>
    <path d="M6.5 4L2.5 7.5l4 3.5" />
    <path d="M2.5 7.5h6a4 4 0 0 1 4 4v1" />
  </Icon>
);

export const ForwardIcon = () => (
  <Icon>
    <path d="M9.5 4l4 3.5-4 3.5" />
    <path d="M13.5 7.5h-6a4 4 0 0 0-4 4v1" />
  </Icon>
);
