import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// Pages the end-to-end test has bots use: a form, a long virtualized list
// in a dialog that scrolls inside itself under a sticky header, as
// Instagram's group members are, and a page that loads more as it is
// scrolled to its end.

const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:16px system-ui;margin:24px}</style></head><body>${body}</body></html>`;

export const members = 1000;
export const feedItems = 150;

const form = page(
  "Greeter",
  `<label for="who">Name</label> <input id="who" value="someone">
<button id="greet">Greet</button>
<p id="said"></p>
<iframe src="/inner" title="Embedded"></iframe>
<script>
  greet.onclick = () => { said.textContent = "Hello, " + who.value + "!"; };
</script>`,
);

// A form inside the form's page, as embedded ones are.
const inner = page(
  "Embedded",
  `<button id="inside">Inside</button><p id="heard"></p>
<script>
  inside.onclick = () => { heard.textContent = "Clicked inside"; };
</script>`,
);

// Only the rows in view, and a few around them, exist at a time.
const list = page(
  "Group members",
  `<div role="dialog" aria-label="Members" style="position:fixed;left:40px;top:60px;width:360px;border:1px solid #ccc;background:#fff">
  <div id="list" style="height:480px;overflow-y:auto;position:relative">
    <div style="position:sticky;top:0;z-index:1;background:#fff;padding:8px;font-weight:600">Members</div>
    <div id="rows" style="position:relative"></div>
  </div>
</div>
<p>Behind the dialog: the group's posts.</p>
<script>
  const height = 32, total = ${members};
  rows.style.height = total * height + "px";
  const draw = () => {
    const first = Math.max(0, Math.floor(list.scrollTop / height) - 5);
    const last = Math.min(total, first + Math.ceil(480 / height) + 10);
    rows.replaceChildren();
    for (let index = first; index < last; index++) {
      const row = document.createElement("div");
      const n = String(index + 1).padStart(4, "0");
      row.style.cssText = "position:absolute;left:8px;right:8px;height:" + height + "px;top:" + index * height + "px;display:flex;gap:8px;align-items:center";
      row.innerHTML = "<span>Member " + n + "</span><span style=color:#888>@member" + n + "</span>";
      rows.append(row);
    }
  };
  list.addEventListener("scroll", draw);
  draw();
</script>`,
);

// Thirty more items a moment after the end comes into view, until all are
// there; with the second thirty, a banner above pushes the read ones down.
const feed = page(
  "Feed",
  `<ol id="items"></ol><p id="end" hidden>End of feed</p>
<script>
  let shown = 0, loading = false;
  const more = () => {
    for (let i = 0; i < 30 && shown < ${feedItems}; i++) {
      const item = document.createElement("li");
      item.style.height = "48px";
      item.textContent = "Post number " + ++shown;
      items.append(item);
    }
    if (shown >= ${feedItems}) end.hidden = false;
    if (shown === 60) {
      const banner = document.createElement("p");
      banner.style.height = "170px";
      banner.textContent = "Sponsored";
      document.body.prepend(banner);
    }
  };
  more();
  addEventListener("scroll", () => {
    if (loading || shown >= ${feedItems}) return;
    if (scrollY + innerHeight < document.documentElement.scrollHeight - 200) return;
    loading = true;
    setTimeout(() => { more(); loading = false; }, 400);
  });
</script>`,
);

const pages: Record<string, string> = {
  "/feed": feed,
  "/form": form,
  "/inner": inner,
  "/members": list,
};

// Serves them on a free port of this computer: its address, and how to
// stop.
export const serveFixtures = async () => {
  const server = createServer((request, response) => {
    const html = pages[request.url ?? ""];
    response.writeHead(html ? 200 : 404, { "content-type": "text/html" });
    response.end(html ?? "Not found");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return { stop: () => server.close(), url: `http://127.0.0.1:${port}/` };
};
