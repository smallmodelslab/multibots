// How a bot sounds in a voice chat. On ChatGPT the voices are those of
// Codex's voice mode (gpt-live-1-codex); its calls take nothing but the
// voice, so the pace and the language are asked of the voice in words.
// Asked to, it speaks slower, but no faster than it does. On the user's own
// speech model the voice is one its server offers.
export type VoiceSettings = {
  voice: string;
  // Null for the speech server's default.
  ownVoice: string | null;
  speed: "normal" | "slow";
  // Null to speak whatever the user speaks.
  language: string | null;
};

export const defaultVoice: VoiceSettings = {
  language: null,
  ownVoice: null,
  speed: "normal",
  voice: "cove",
};

export const voices = [
  "arbor",
  "aube",
  "breeze",
  "bubbie",
  "cove",
  "ember",
  "haetsal",
  "hanul",
  "himari",
  "juniper",
  "leher",
  "maple",
  "miko",
  "neer",
  "porto",
  "rindo",
  "rio",
  "rivage",
  "selva",
  "sol",
  "sonna",
  "spruce",
  "tinta",
  "vale",
  "viola",
];

export const speeds: Record<VoiceSettings["speed"], string> = {
  normal: "Normal",
  slow: "Slow",
};

export const languages = [
  "English",
  "Arabic",
  "Bengali",
  "Catalan",
  "Chinese (Mandarin)",
  "Danish",
  "Dutch",
  "Finnish",
  "French",
  "German",
  "Hindi",
  "Hungarian",
  "Indonesian",
  "Italian",
  "Japanese",
  "Korean",
  "Polish",
  "Portuguese (Brazil)",
  "Portuguese (Portugal)",
  "Russian",
  "Spanish (Mexico)",
  "Spanish (Spain)",
  "Swedish",
  "Thai",
  "Turkish",
  "Vietnamese",
];
