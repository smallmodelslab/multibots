import { z } from "zod";

// A bot of Grok Bot's, in the recipe Grok Bot shares its templates in: its
// profile (`description` is its instructions), what it remembers, its
// skills, routines and plugins, and the skill it starts with. A bot read
// from Grok Bot's app on this computer has its profile alone.
const text = z.string().trim();
export const grokRecipeSchema = z.object({
  profile: z.object({
    name: text.min(1),
    description: text.default(""),
    avatarColor: z.string().optional(),
  }),
  memory: z
    .array(
      z.object({
        kind: z.string().nullish(),
        createdAt: z.string().nullish(),
        content: text.min(1),
      }),
    )
    .default([]),
  skills: z
    .array(
      z.object({
        name: text.min(1),
        description: text.default(""),
        content: z.string().default(""),
      }),
    )
    .default([]),
  routines: z
    .array(
      z.object({
        name: text.min(1),
        description: text.default(""),
        content: z.string().default(""),
      }),
    )
    .default([]),
  plugins: z.array(z.object({ name: text.min(1) })).default([]),
  gettingStarted: z.object({ skill: text.min(1) }).optional(),
});

export type GrokRecipe = z.infer<typeof grokRecipeSchema>;

// Grok Bot's avatar colours as the nearest of a bot's colours here; its
// black, brown and gray have none.
export const grokHues: Partial<Record<string, number>> = {
  blue: 215,
  cyan: 185,
  green: 145,
  magenta: 300,
  orange: 20,
  red: 330,
  violet: 265,
  yellow: 55,
};
