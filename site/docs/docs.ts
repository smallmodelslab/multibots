import "@fontsource-variable/inter";
import "@fontsource-variable/familjen-grotesk";
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
// first before any, and the last once the page is scrolled to its end.
let current: HTMLAnchorElement | undefined;
function mark() {
  const end =
    innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
  let index = 0;
  headings.forEach((heading, i) => {
    if (heading.getBoundingClientRect().top <= 80) index = i;
  });
  const active = entries[end ? entries.length - 1 : index];
  if (active === current) return;
  current?.removeAttribute("aria-current");
  active?.setAttribute("aria-current", "location");
  current = active;
}
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
