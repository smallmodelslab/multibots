import { z } from "zod";

export const hats = ["none", "beanie", "cap", "top-hat", "party"] as const;
export const glasses = ["none", "round", "square", "sunglasses"] as const;
export const accessoriesSchema = z.object({
  hat: z.enum(hats),
  glasses: z.enum(glasses),
});
export const appearanceSchema = accessoriesSchema.extend({
  hue: z.number().min(0).lt(360),
});
export type Accessories = z.infer<typeof accessoriesSchema>;
export const accessoryNames: Record<
  Accessories["hat"] | Accessories["glasses"],
  string
> = {
  none: "None",
  beanie: "Beanie",
  cap: "Cap",
  "top-hat": "Top hat",
  party: "Party hat",
  round: "Round",
  square: "Square",
  sunglasses: "Sunglasses",
};
export type Identity = { id: string; hue: number; accessories?: Accessories };

export const seedOf = (id: string) => {
  let seed = 2166136261;
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
};

export const defaultAccessories = (id: string): Accessories => {
  const seed = seedOf(id);
  return {
    hat: hats[seed % hats.length]!,
    glasses: glasses[(seed >>> 8) % glasses.length]!,
  };
};

export const appearanceOf = (bot: Identity) =>
  appearanceSchema.parse({
    hue: bot.hue,
    ...accessoriesSchema.parse(bot.accessories ?? defaultAccessories(bot.id)),
  });
export type Appearance = ReturnType<typeof appearanceOf>;
