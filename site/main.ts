import "@fontsource-variable/inter";
import "@fontsource-variable/familjen-grotesk";
import "@wrkrsh/pencil/pencil.css";
import "./style.css";
import {
  createBot,
  ease,
  plain,
  rest,
  type Director,
  type Outfit,
} from "./bot";

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const wide = matchMedia("(min-width: 50rem)");
const steps = [...document.querySelectorAll<HTMLElement>(".step")];
const host = document.querySelector<HTMLElement>(".bot")!;
const bot = createBot(host, reduced);
const dressed: Outfit = { hue: 215, hat: "cap", glasses: "round" };
const outfits: Outfit[] = [
  { hue: 330, hat: "party", glasses: "none" },
  { hue: 145, hat: "beanie", glasses: "square" },
  { hue: 20, hat: "top-hat", glasses: "sunglasses" },
  { hue: 265, hat: "none", glasses: "round" },
  { hue: 55, hat: "beanie", glasses: "none" },
  dressed,
];

// Wide, the bot takes the half its words don't (style.css) and reads them
// beside it; narrow, they are under it.
let side = 1;
const words = () =>
  wide.matches ? { gx: -side, gy: 0.1 } : { gx: 0, gy: 0.9 };

async function hop(bot: Director, tilt: number) {
  await bot.to({ sx: 1.08, sy: 0.9 }, 90, ease.out);
  await bot.to({ sx: 0.95, sy: 1.07, lift: -26, tilt }, 210, ease.out);
  await bot.to({ sx: 1, sy: 1, lift: 0 }, 190, ease.in);
  await bot.to({ sx: 1.1, sy: 0.88 }, 70, ease.out);
  await bot.to({ sx: 1, sy: 1 }, 170, ease.back);
}
async function excited(bot: Director, hops: number) {
  await bot.to({ curve: 1 }, 0);
  await bot.to({ open: 0 }, 120);
  bot.mark("joy", hops * 700);
  for (let i = 0; i < hops; i++) await hop(bot, i % 2 ? 6 : -6);
  await bot.to({ open: 1, tilt: 0 }, 180);
}

// Asleep in the middle of the page, it wakes, looks around, sees the visitor
// and is thrilled, then rises to make room for what it says.
async function intro(bot: Director) {
  await bot.wait(1300);
  await bot.to({ open: 0.3, tilt: -2 }, 420);
  await bot.wait(240);
  await bot.to({ open: 0, tilt: 0 }, 280);
  await bot.wait(420);
  await bot.to({ open: 1, sx: 0.97, sy: 1.04 }, 200, ease.out);
  bot.blink();
  await bot.to({ sx: 1, sy: 1 }, 220);
  await bot.wait(320);
  await bot.to({ gx: -1, gy: 0.05, tilt: -3 }, 420);
  await bot.wait(560);
  await bot.to({ gx: 1, gy: -0.15, tilt: 3 }, 540);
  await bot.wait(500);
  await bot.to({ gx: 0.4, gy: 0.4, tilt: 0 }, 320);
  await bot.wait(240);
  await bot.to(
    { gx: 0, gy: 0, open: 1.3, sx: 1.07, sy: 1.07, lift: -4 },
    140,
    ease.out,
  );
  bot.mark("alert", 900);
  await bot.wait(560);
  await bot.to({ sx: 1, sy: 1, lift: 0 }, 120);
  await excited(bot, 3);
  wake();
  await bot.wait(500);
  speak(steps[0]!);
  await bot.wait(1900);
  await bot.to(words(), 420);
  await bot.wait(1000);
}

// What the bot does while it says each step, by the step's data-act.
const acts: Record<string, (bot: Director) => Promise<void>> = {
  async hello(bot) {
    await excited(bot, 1);
  },
  async home(bot) {
    await bot.to({ curve: 1 }, 0);
    await bot.to({ open: 0, gx: 0, gy: 0 }, 160);
    for (const tilt of [-4, 4, 0]) await bot.to({ tilt, lift: -3 }, 260);
    await bot.to({ open: 1, lift: 0 }, 180);
  },
  async use(bot) {
    for (let i = 0; i < 3; i++) {
      await bot.to({ gx: -0.8, gy: 0.6, lift: -1 }, 260);
      await bot.to({ gx: 0.8, gy: 0.6, lift: 0 }, 520, ease.out);
    }
    await bot.to({ gx: 0, gy: 0 }, 300);
  },
  async wake(bot) {
    await bot.to({ curve: -1 }, 0);
    await bot.to({ open: 0, gx: 0, gy: 0.2, lift: 2 }, 500);
    bot.mark("zzz", 1900);
    await bot.wait(2000);
    bot.mark("alert", 800);
    await bot.to(
      { open: 1.3, gy: 0, lift: -6, sx: 1.06, sy: 1.06 },
      140,
      ease.out,
    );
    await bot.wait(500);
    await bot.to({ open: 1, lift: 0, sx: 1, sy: 1 }, 260);
  },
  async talk(bot) {
    bot.talk(2400);
    bot.mark("waves", 2400);
    await bot.to({ gx: 0, gy: 0 }, 200);
    await bot.wait(2400);
  },
  async apps(bot) {
    await bot.to({ gx: -0.9, gy: -0.7, open: 1.15, tilt: -3 }, 320);
    await bot.wait(380);
    await bot.to({ gx: 0.9, gy: -0.7, tilt: 3 }, 420);
    await bot.wait(380);
    await bot.to({ gx: 0, gy: 0, open: 1, tilt: 0 }, 300);
  },
  async anywhere(bot) {
    await bot.to({ gx: -1, gy: 0, tilt: -5, sx: 0.98 }, 380);
    await bot.wait(700);
    await bot.to({ gx: 1, tilt: 5 }, 600);
    await bot.wait(700);
    await bot.to({ gx: 0, tilt: 0, sx: 1 }, 380);
  },
  async yours(bot) {
    await bot.to({ color: 1 }, 300);
    for (const outfit of outfits) {
      bot.dress(outfit);
      await bot.to(
        { sx: 1.08, sy: 0.92, tilt: outfit.hue % 2 ? 4 : -4 },
        80,
        ease.out,
      );
      await bot.to({ sx: 1, sy: 1, tilt: 0 }, 320, ease.back);
    }
    await excited(bot, 1);
  },
  async download(bot) {
    await excited(bot, 2);
    await bot.to(words(), 400);
    await bot.wait(1600);
  },
};

// Each step is said once, word by word, the first time it is reached.
for (const step of steps) {
  const say = step.querySelector(".say")!;
  const walker = document.createTreeWalker(say, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  let index = 0;
  for (const text of texts) {
    if (text.parentElement?.closest(".whole")) continue;
    const words = text.data.split(/(\s+)/).map((part) => {
      if (!part.trim()) return document.createTextNode(part);
      const word = document.createElement("span");
      word.className = "w";
      word.style.setProperty("--i", String(index++));
      word.textContent = part;
      return word;
    });
    text.replaceWith(...words);
  }
  for (const whole of say.querySelectorAll<HTMLElement>(".whole"))
    whole.style.setProperty("--i", String(index++ + 2));
  step.dataset.words = String(index);
}
function speak(step: HTMLElement) {
  if (step.classList.contains("spoken")) return;
  step.classList.add("spoken");
  bot.talk(Number(step.dataset.words) * 45 + 250);
}

let active = -1;
let introDone = reduced;
function activate(index: number) {
  active = index;
  side = index % 2 ? -1 : 1;
  const step = steps[index]!;
  if (!introDone) {
    if (index === 0) return;
    introDone = true;
    wake();
  }
  // A visitor who moves on finds the bot already out of the words' way.
  rising?.finish();
  speak(step);
  const yours = steps.findIndex((s) => s.dataset.act === "yours");
  const act = acts[step.dataset.act!]!;
  // Before "yours" the bot is plain; from there on it keeps its outfit. With
  // reduced motion it only takes each step's outfit, without acting.
  const montage = index === yours && !reduced;
  void bot.play(async (bot) => {
    if (!montage) bot.dress(index < yours ? plain : dressed);
    const color = montage ? {} : { color: index < yours ? 0 : 1 };
    await bot.to({ ...rest, open: 1, ...color }, 220);
    if (!reduced) await act(bot);
  });
}

// Waking, the bot rises from where it slept to wherever the scroll has it.
let rising: Animation | undefined;
function wake() {
  if (document.body.classList.contains("awake")) return;
  document.body.classList.add("awake");
  if (!reduced)
    rising = host.animate([{ transform: "none", offset: 0 }], {
      duration: 1200,
      easing: "cubic-bezier(0.45, 0, 0.15, 1)",
    });
}

// A step shows while it is near the top of the window, so the bot says one
// thing at a time. Wide, the bot crosses halves with the scroll, reaching the
// middle when no words are there.
let queued = 0;
function onScroll() {
  queued = 0;
  let nearest = 0;
  let distance = Infinity;
  steps.forEach((step, index) => {
    const away = Math.abs(step.getBoundingClientRect().top) / innerHeight;
    const t = Math.max(0, Math.min(1, (away - 0.12) / 0.38));
    step.style.setProperty("--seen", String(1 - t * t * (3 - 2 * t)));
    if (away < distance) [nearest, distance] = [index, away];
  });
  if (nearest !== active) activate(nearest);
  const first = steps[0]!.getBoundingClientRect();
  const at = -first.top / first.height;
  host.style.setProperty(
    "--x",
    String(reduced ? side : Math.cos(Math.PI * at)),
  );
}
addEventListener("scroll", () => (queued ||= requestAnimationFrame(onScroll)), {
  passive: true,
});
addEventListener("resize", onScroll);
document.documentElement.classList.add("js");
onScroll();
if (reduced) {
  wake();
} else if (active === 0) {
  void bot.play(async (bot) => {
    await intro(bot);
    introDone = true;
  });
}

// Linux visitors see their download first.
if (/Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent)) {
  document.querySelector(".actions")?.classList.add("linux");
}

// Every product reports to one PostHog project, told apart by `product`
// (docs/analytics.md in wrkrsh/monorepo). Only the production site loads it.
if (location.hostname === "openbots.ca") {
  void import("posthog-js").then(({ default: posthog }) => {
    posthog.init("phc_oFwEfJVgTTkyJDj6xCPSCb2bbSjb7suJYan9AyfJBqpr", {
      api_host: "/antenna",
      ui_host: "https://us.posthog.com",
      defaults: "2026-08-30",
      mask_all_text: true,
      mask_all_element_attributes: true,
      disable_session_recording: true,
      before_send: (event) => {
        if (event)
          Object.assign(event.properties, {
            product: "openbots",
            surface: "web",
          });
        return event;
      },
    });
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      "a[data-download]",
    ))
      link.addEventListener("click", () =>
        posthog.capture(
          "desktop download clicked",
          { platform: link.dataset.download },
          { transport: "sendBeacon" },
        ),
      );
  });
}
