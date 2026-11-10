// A bot's colour, from its hue. Fixed bubble shades keep white text above
// 5:1 contrast in either appearance.
export const botColors = [
  { name: "Green", hue: 145, lightness: 29 },
  { name: "Blue", hue: 215, lightness: 48 },
  { name: "Purple", hue: 265, lightness: 55 },
  { name: "Orange", hue: 20, lightness: 41 },
  { name: "Pink", hue: 330, lightness: 47 },
  { name: "Yellow", hue: 55, lightness: 27 },
  { name: "Teal", hue: 185, lightness: 30 },
  { name: "Magenta", hue: 300, lightness: 43 },
  { name: "Lime", hue: 100, lightness: 29 },
  { name: "Indigo", hue: 240, lightness: 55 },
];

// The first colour no bot wears yet, then round again.
export const nextHue = (used: number[]) =>
  botColors.find(({ hue }) => !used.includes(hue))?.hue ??
  botColors[used.length % botColors.length]!.hue;

export const botColor = (hue: number) => {
  const color = botColors.find((each) => each.hue === hue) ?? botColors[1]!;
  return `hsl(${color.hue} 70% ${color.lightness}%)`;
};
