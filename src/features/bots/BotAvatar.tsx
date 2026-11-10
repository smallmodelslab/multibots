import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";
import { SquircleAvatar } from "../avatars/SquircleAvatar";
import type { Identity } from "../avatars/appearance";
import { Avatar, AvatarBadge } from "../ui/avatar";
import { avatarOf } from "./avatars";
import "./bots.css";

// One squircle identity, shared by every avatar of this bot.
export const BotAvatar = ({
  bot,
  size = 18,
  working = false,
}: {
  bot: Identity;
  size?: number;
  working?: boolean;
}) => {
  const dot = Math.min(11, Math.max(6, Math.round(size * 0.28)));
  return (
    <Avatar
      aria-hidden="true"
      className="overflow-visible rounded-none after:hidden"
      style={
        { "--bot-hue": bot.hue, height: size, width: size } as CSSProperties
      }
    >
      <SquircleAvatar
        className="bot-avatar"
        controller={avatarOf(bot)}
        size="100%"
      />
      {working ? (
        <AvatarBadge
          className={cn(
            "-right-px -bottom-px animate-pulse bg-[var(--green)] ring-[1.5px] ring-[var(--surface,var(--background-0))]",
          )}
          style={{ height: dot, width: dot }}
        />
      ) : null}
    </Avatar>
  );
};
