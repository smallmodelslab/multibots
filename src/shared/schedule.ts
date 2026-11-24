import { senders } from "@wrkrsh/webhooks";

import type { Routine, Webhook } from "./types";

// When a routine wakes its bot: a time, once or every week on chosen days,
// or every so many minutes within hours of chosen days; or whenever its
// webhook is called (src/main/webhooks.ts). Days are 0 for Sunday to 6 for
// Saturday; times are wall-clock in `timeZone`, minutes after midnight
// (`until` up to 1440, the day's end), so a routine keeps its time across
// daylight saving changes.
export type Schedule =
  | { kind: "once"; at: number }
  | {
      kind: "weekly";
      days: number[];
      hour: number;
      minute: number;
      timeZone: string;
    }
  | {
      kind: "every";
      minutes: number;
      days: number[];
      from: number;
      until: number;
      timeZone: string;
    }
  | { kind: "webhook" };

// The calendar date and time `at` shows in `timeZone`.
const wallClock = (at: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    minute: "numeric",
    month: "numeric",
    second: "numeric",
    timeZone,
    year: "numeric",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((each) => each.type === type)!.value);
  return {
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    month: part("month"),
    second: part("second"),
    year: part("year"),
  };
};

// How far `timeZone` is ahead of UTC at `at`.
const offsetAt = (at: number, timeZone: string) => {
  const shown = wallClock(at, timeZone);
  return (
    Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute,
      shown.second,
    ) -
    Math.floor(at / 1000) * 1000
  );
};

// The moment a wall-clock time happens in `timeZone`. A daylight saving
// change is at most a day either side, so the time is read with the offset
// from before it, then after it. A repeated time is the first; a skipped one
// is read with the offset from before, which puts it later by the jump.
const zonedMoment = (
  date: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  timeZone: string,
) => {
  const asUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const day = 24 * 60 * 60 * 1000;
  const before = asUtc - offsetAt(asUtc - day, timeZone);
  const after = asUtc - offsetAt(asUtc + day, timeZone);
  const shows = (at: number) => {
    const shown = wallClock(at, timeZone);
    return (
      shown.day === date.day && shown.hour === hour && shown.minute === minute
    );
  };
  return shows(before) || !shows(after) ? before : after;
};

// Whether `at` falls within the hours and days a routine repeats in.
export const within = (
  schedule: Extract<Schedule, { kind: "every" }>,
  at: number,
) => {
  const shown = wallClock(at, schedule.timeZone);
  const minutes = shown.hour * 60 + shown.minute;
  return (
    schedule.days.includes(
      new Date(Date.UTC(shown.year, shown.month - 1, shown.day)).getUTCDay(),
    ) &&
    minutes >= schedule.from &&
    minutes < schedule.until
  );
};

// When the routine next wakes its bot after `after`, or null for a one-off
// that has passed and for a webhook, which no clock wakes.
export const nextRun = (schedule: Schedule, after: number): number | null => {
  if (schedule.kind === "webhook") return null;
  if (schedule.kind === "once") return schedule.at > after ? schedule.at : null;
  if (schedule.kind === "every") {
    const beat = after + schedule.minutes * 60_000;
    if (within(schedule, beat)) return beat;
    // The window's next start, or the one after when a daylight saving
    // change moves it past the window's end, as a start in the skipped hour.
    const start = {
      days: schedule.days,
      hour: Math.floor(schedule.from / 60),
      kind: "weekly" as const,
      minute: schedule.from % 60,
      timeZone: schedule.timeZone,
    };
    let at = nextRun(start, after);
    for (let tries = 0; at !== null && tries < 8; tries += 1) {
      if (within(schedule, at)) return at;
      at = nextRun(start, at);
    }
    return null;
  }
  const today = wallClock(after, schedule.timeZone);
  // Today through a week from today always holds the next one.
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(
      Date.UTC(today.year, today.month - 1, today.day + offset),
    );
    if (!schedule.days.includes(day.getUTCDay())) continue;
    const at = zonedMoment(
      {
        day: day.getUTCDate(),
        month: day.getUTCMonth() + 1,
        year: day.getUTCFullYear(),
      },
      schedule.hour,
      schedule.minute,
      schedule.timeZone,
    );
    if (at > after) return at;
  }
  return null;
};

const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const sameDays = (days: number[], others: number[]) =>
  days.length === others.length && days.every((day, i) => day === others[i]);

const listed = (names: string[]) =>
  names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
    : (names[0] ?? "");

const zoneName = (timeZone: string, at: number) =>
  new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: "short" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value ?? timeZone;

const dayPhrase = (days: number[]) =>
  days.length === 7
    ? "Every day"
    : sameDays(days, [1, 2, 3, 4, 5])
      ? "Weekdays"
      : sameDays(days, [0, 6])
        ? "Weekends"
        : days.length === 1
          ? `Every ${dayNames[days[0]!]}`
          : listed(days.map((day) => `${dayNames[day]}s`));

// A time of day given as minutes after midnight.
const timeOfDay = (minutes: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(Date.UTC(2000, 0, 1, 0, minutes));

// When a routine runs, as the user reads it: "Weekdays at 8:30 AM", "Once,
// Tue, Oct 13, 7:59 AM", "Every hour, 8:00 AM – 11:00 PM", "When its webhook
// is called". One kept in another time zone than this computer's says which.
export const describeSchedule = (
  schedule: Schedule,
  nextRunAt: number | null,
) => {
  if (schedule.kind === "webhook") return "When its webhook is called";
  if (schedule.kind === "once")
    return `Once, ${new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      weekday: "short",
    }).format(schedule.at)}`;
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zone =
    schedule.timeZone === here
      ? ""
      : ` ${zoneName(schedule.timeZone, nextRunAt ?? Date.now())}`;
  if (schedule.kind === "weekly")
    return `${dayPhrase(schedule.days)} at ${timeOfDay(schedule.hour * 60 + schedule.minute)}${zone}`;
  // All day, the time zone still says when its days begin.
  const allDay = schedule.from === 0 && schedule.until === 24 * 60;
  const days =
    schedule.days.length === 7
      ? ""
      : `${dayPhrase(schedule.days)}${allDay ? zone : ""}`;
  const hours = allDay
    ? ""
    : `${timeOfDay(schedule.from)} – ${timeOfDay(schedule.until)}${zone}`;
  const when = [days, hours]
    .filter(Boolean)
    .join(" ")
    .replace(/^(Every|Weekdays|Weekends)/, (word) => word.toLowerCase());
  const { minutes } = schedule;
  const every =
    minutes === 60
      ? "Every hour"
      : minutes % 60 === 0
        ? `Every ${minutes / 60} hours`
        : `Every ${minutes} min`;
  return when ? `${every}, ${when}` : every;
};

// What a webhook routine waits for before it takes its sender's requests,
// or null once it takes them.
export const webhookWait = (routine: Routine, webhook: Webhook | undefined) =>
  routine.schedule.kind !== "webhook" || !webhook
    ? null
    : webhook.secret === null
      ? "needs its secret"
      : webhook.registered
        ? null
        : "not registered yet";

// What wakes a routine: when it runs, or for a webhook who calls it, as
// "Webhook · GitHub".
export const describeSource = (
  routine: Routine,
  webhook: Webhook | undefined,
) =>
  routine.schedule.kind !== "webhook"
    ? describeSchedule(routine.schedule, routine.nextRunAt)
    : webhook
      ? `Webhook · ${senders[webhook.sender].label}`
      : "Webhook";

// A routine's line in a list: what wakes it, and what a webhook waits for,
// as "Webhook · Stripe · needs its secret".
export const describeTrigger = (
  routine: Routine,
  webhook: Webhook | undefined,
) => {
  const wait = webhookWait(routine, webhook);
  const source = describeSource(routine, webhook);
  return wait ? `${source} · ${wait}` : source;
};
