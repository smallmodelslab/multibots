import { createFlags, type Channel } from "@wrkrsh/flags";

import { bridge } from "./data";

// Features in progress, under Flags at the bottom of Settings. Delete a flag,
// and the code path it hides, once its feature is on in stable.
export const flags = createFlags("openbots.flags", {});

export type FlagId = keyof typeof flags.definitions;

// Analytics and log records name the flags on, from when the channel that
// picks their defaults is known.
const report = () => bridge.setFlags(flags.active());
export const followChannel = (channel: Channel) => {
  flags.setChannel(channel);
  report();
};
flags.subscribe(report);
