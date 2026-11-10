import { useEffect } from "react";
import { appearanceOf, seedOf, type Identity } from "../avatars/appearance";
import {
  createAvatarController,
  type AvatarController,
} from "../avatars/controller";

export type Mood = "resting" | "working" | "asking";
export type Cue = "greeted" | "told" | "stopped" | "poked";
type Spirit = {
  avatar: AvatarController;
  appearance: string;
  mood: Mood;
  step: string | null;
  listeners: number;
  talkers: number;
};
const spirits = new Map<string, Spirit>();
const spiritOf = (bot: Identity) => {
  const appearance = appearanceOf(bot),
    key = JSON.stringify(appearance);
  let spirit = spirits.get(bot.id);
  if (!spirit) {
    spirit = {
      avatar: createAvatarController(appearance, seedOf(bot.id) % 6000),
      appearance: key,
      mood: "resting",
      step: null,
      listeners: 0,
      talkers: 0,
    };
    spirits.set(bot.id, spirit);
  } else if (spirit.appearance !== key) {
    spirit.appearance = key;
    spirit.avatar.setState({ appearance });
  }
  return spirit;
};
export const avatarOf = (bot: Identity) => spiritOf(bot).avatar;
export const settle = (bot: Identity, mood: Mood, step: string | null) => {
  const spirit = spiritOf(bot);
  if (spirit.mood !== mood) {
    spirit.avatar.setState({
      motion: mood === "resting" ? "look-around" : mood,
    });
    if (mood === "resting") spirit.avatar.react();
  } else if (mood === "working" && spirit.step !== step) spirit.avatar.blink();
  spirit.mood = mood;
  spirit.step = step;
};
export const cue = (id: string, what: Cue) => {
  const spirit = spirits.get(id);
  if (!spirit) return;
  if (what === "stopped") {
    spirit.mood = "resting";
    spirit.avatar.setState({ motion: "look-around" });
  }
  spirit.avatar.blink();
};
export const useAvatarListening = (id: string | null, listening: boolean) =>
  useEffect(() => {
    const spirit = id ? spirits.get(id) : undefined;
    if (!listening || !spirit) return;
    spirit.listeners++;
    spirit.avatar.lookAt(0, 0.9);
    return () => {
      spirit.listeners--;
      if (!spirit.listeners) spirit.avatar.releaseGaze();
    };
  }, [id, listening]);
export const useAvatarTalking = (
  { id, hue, accessories }: Identity,
  talking: boolean,
) =>
  useEffect(() => {
    if (!talking) return;
    const spirit = spiritOf({ id, hue, accessories });
    spirit.talkers++;
    spirit.avatar.setState({ talking: true });
    return () => {
      spirit.talkers--;
      if (!spirit.talkers) spirit.avatar.setState({ talking: false });
    };
  }, [id, hue, accessories, talking]);
