import { UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";

export type Person = { name: string; picture: string | null };

const initialOf = (name: string) =>
  (/\p{L}/u.exec(name)?.[0] ?? "").toUpperCase();

// The signed-in user: their picture, else the first letter of their name.
export const UserAvatar = ({
  person,
  size,
}: {
  person: Person | null;
  size: number;
}) => (
  <Avatar
    className="shrink-0 after:hidden"
    style={{ height: size, width: size }}
  >
    {person?.picture ? <AvatarImage alt="" src={person.picture} /> : null}
    <AvatarFallback
      className="user-avatar-initial"
      style={{ fontSize: Math.round(size / 2) }}
    >
      {initialOf(person?.name ?? "") || (
        <UserRound
          aria-hidden
          size={Math.round(size * 0.55)}
          strokeWidth={1.5}
        />
      )}
    </AvatarFallback>
  </Avatar>
);
