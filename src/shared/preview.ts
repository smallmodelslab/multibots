import type { Bot } from "./types";

// How lists and quotes say a message in a line: its text without markdown,
// and when it was said.

export const previewOf = (text: string) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// What a bot last said, or what it is for before it said anything.
export const botPreview = (bot: Bot) =>
  previewOf(
    bot.last
      ? bot.last.text ||
          bot.last.forwarded?.text ||
          (bot.last.attachments ?? []).map((file) => file.name).join(", ")
      : bot.instructions,
  );

const dayMs = 24 * 60 * 60 * 1000;
const startOfDay = (at: number) => new Date(at).setHours(0, 0, 0, 0);

// How many days before `now`'s day `at` fell.
export const daysAgo = (at: number, now: number) =>
  Math.round((startOfDay(now) - startOfDay(at)) / dayMs);

// When a chat last spoke, as a list says it.
export const listTime = (at: number, now: number) => {
  const days = daysAgo(at, now);
  const date = new Date(at);
  if (days <= 0)
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "numeric",
    year: "2-digit",
  });
};
