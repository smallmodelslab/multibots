import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { grokRecipeSchema, type GrokRecipe } from "../shared/grokBot";

// What Grok Bot's app keeps of its bots for its sidebar, a JSON file per
// account, each file named by its key in base32.
const rosterSchema = z.object({
  value: z.object({
    rows: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        avatarColor: z.string().optional(),
        isGroup: z.boolean().optional(),
      }),
    ),
  }),
});

const base32 = (encoded: string) => {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of encoded.toUpperCase()) {
    const digit = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char);
    if (digit < 0) return "";
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 255);
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
};

// The bots of every account signed in to Grok Bot on this computer, whose
// apps keep their data in `appData`, each with its name, instructions and
// colour; none without Grok Bot.
export const localGrokBots = async (appData: string): Promise<GrokRecipe[]> => {
  const dir = join(appData, "Grok Bot", "sand-client-persistence");
  const seen = new Set<string>();
  const recipes: GrokRecipe[] = [];
  for (const file of await readdir(dir).catch(() => [])) {
    if (!base32(file.replace(/\.blob$/, "")).endsWith(".roster.last-roster"))
      continue;
    const roster = rosterSchema.safeParse(
      await readFile(join(dir, file), "utf8")
        .then(JSON.parse)
        .catch(() => null),
    );
    for (const row of roster.data?.value.rows ?? []) {
      if (row.isGroup || seen.has(row.id) || !row.name.trim()) continue;
      seen.add(row.id);
      recipes.push(
        grokRecipeSchema.parse({
          profile: {
            avatarColor: row.avatarColor,
            description: row.description,
            name: row.name,
          },
        }),
      );
    }
  }
  return recipes;
};

// A bot made from a recipe: its name and instructions, the files its folder
// starts with, by path, and what it sets up itself on its first run, null
// when nothing. Its skills and the log of its work become files, listed in
// its instructions with the rest of what it remembers; it sets up its
// routines, whose schedules Grok Bot says in words, and its apps itself.
export const fromRecipe = (input: GrokRecipe) => {
  const { gettingStarted, memory, plugins, profile, routines, ...recipe } =
    grokRecipeSchema.parse(input);
  const taken = new Set<string>();
  const skills = recipe.skills.map((skill) => {
    const base =
      skill.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 60)
        .replace(/^-|-$/g, "") || "skill";
    let file = `${base}.md`;
    for (let n = 2; taken.has(file); n += 1) file = `${base}-${n}.md`;
    taken.add(file);
    return { ...skill, path: `skills/${file}` };
  });
  const known = memory.filter((entry) => entry.kind !== "log");
  const log = memory.filter((entry) => entry.kind === "log");
  const files = skills.map(
    ({ content, description, path }): [path: string, content: string] => [
      path,
      content || description,
    ],
  );
  if (log.length)
    files.push([
      "memory.md",
      log
        .map(
          ({ content, createdAt }) =>
            `- ${createdAt ? `${createdAt}: ` : ""}${content}`,
        )
        .join("\n"),
    ]);
  const setup = [
    routines.length
      ? `Set up your routines from there with set_routine, each paused on the schedule it describes, since your bot in Grok Bot may still run them; ask the user for any schedule one leaves out, and whether to turn them on: ${JSON.stringify(routines.map(({ content, description, name }) => ({ description, instructions: content, name })))}`
      : "",
    plugins.length
      ? `You used these apps there: ${plugins.map(({ name }) => name).join(", ")}. Give the user a link to connect any your plugins have not connected yet; if you have no plugins, tell the user to connect them on the Plugins page.`
      : "",
    gettingStarted
      ? `Then start with your skill "${gettingStarted.skill}".`
      : "",
  ].filter(Boolean);
  return {
    files,
    instructions: [
      profile.description,
      known.length
        ? `What you know of the user:\n${known.map(({ content }) => `- ${content}`).join("\n")}`
        : "",
      skills.length
        ? `Your skills, each a file in your folder to read before doing what it is for:\n${skills.map(({ description, name, path }) => `- ${name}${description ? `: ${description}` : ""} (${path})`).join("\n")}`
        : "",
      log.length
        ? "What you did before is logged in memory.md in your folder."
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    name: profile.name,
    setup: setup.length
      ? [
          "The user brought you over from Grok Bot.",
          ...setup,
          "Tell the user briefly what you set up.",
        ].join("\n\n")
      : null,
  };
};
