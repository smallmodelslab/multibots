import "@fontsource-variable/inter";
import "../base.css";
import "./docs.css";
import "../analytics";

// The contents list in the margin, one entry per section, as every wrkrsh
// docs page has it (md-components/DOCS-PAGE.md in wrkrsh/monorepo).
const headings = [
  ...document.querySelectorAll<HTMLElement>("article h2, article h3"),
];
const list = document.createElement("ol");
const entries = headings.map((heading) => {
  const item = document.createElement("li");
  item.className = heading.localName;
  const link = document.createElement("a");
  link.href = `#${heading.id}`;
  // A hidden bold copy keeps room for the title in bold.
  for (const hidden of [false, true]) {
    const title = document.createElement("span");
    title.textContent = heading.textContent;
    if (hidden) title.ariaHidden = "true";
    link.append(title);
  }
  item.append(link);
  list.append(item);
  return link;
});
document.querySelector(".contents")!.append(list);

// The section being read: the last heading within 80px of the top, the
// first before any, and the last once a page that scrolls is scrolled to
// its end. An entry followed stays the one being read until the page moves
// from where the jump left it, as when its heading is too near the end to
// reach the top.
let current: HTMLAnchorElement | undefined;
let followed: { entry: HTMLAnchorElement; at: number } | null = null;
function mark() {
  if (followed && Math.abs(scrollY - followed.at) > 1) followed = null;
  const { scrollHeight } = document.documentElement;
  const end =
    scrollHeight > innerHeight + 2 && innerHeight + scrollY >= scrollHeight - 2;
  let index = 0;
  headings.forEach((heading, i) => {
    if (heading.getBoundingClientRect().top <= 80) index = i;
  });
  const active = followed?.entry ?? entries[end ? entries.length - 1 : index];
  if (active === current) return;
  current?.removeAttribute("aria-current");
  active?.setAttribute("aria-current", "location");
  current = active;
}
// The entry for the address's fragment, followed once the jump to it has
// landed, the frame after: when an entry is followed, its fragment is
// arrived at by Back or Forward, or the page opens at it. Only where the
// page shows its heading at the top, or as near it as the page's end lets
// it come; Back can bring back a place the reader scrolled to instead.
const follow = () => {
  const index = entries.findIndex(({ hash }) => hash && hash === location.hash);
  requestAnimationFrame(() => {
    const top = headings[index]?.getBoundingClientRect().top;
    const end =
      innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
    followed =
      top !== undefined && top >= -2 && (top <= 80 || end)
        ? { at: scrollY, entry: entries[index]! }
        : null;
    mark();
  });
};
for (const entry of entries)
  entry.addEventListener("click", (event) => {
    // Not one opened elsewhere, which leaves the page where it is.
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey)
      return;
    // The same fragment again moves no address, so no hashchange tells.
    if (entry.hash === location.hash) follow();
  });
addEventListener("hashchange", follow);
addEventListener("load", follow);
let queued = false;
addEventListener(
  "scroll",
  () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      mark();
    });
  },
  { passive: true },
);
addEventListener("resize", mark);
mark();
