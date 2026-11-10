import type { ReactNode } from "react";

import { ChevronRightIcon } from "../shell/icons";

/** Who a chat is with, floating over its top: their avatar, and their name
    in a pill below, lit with a chevron where it `opens` more about them.
    The caller makes it the button, popover trigger or plain head it is
    (`.profile-float`). */
export const ChatHead = ({
  avatar,
  name,
  opens = false,
}: {
  avatar: ReactNode;
  name: ReactNode;
  opens?: boolean;
}) => (
  <>
    {avatar}
    <span className={opens ? "profile-float-name glow" : "profile-float-name"}>
      <span className="profile-button-name">{name}</span>
      {opens ? <ChevronRightIcon /> : null}
    </span>
  </>
);
