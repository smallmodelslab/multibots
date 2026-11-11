# Chrome Web Store listing

What the OpenBots item in the Chrome Web Store Developer Dashboard says. The
package is `OPENBOTS_VERSION=<version> bun run extension:store` after
`bun run build`; every upload must raise the version.

## Store listing

- **Name:** OpenBots (from the manifest)
- **Summary:** Lets your OpenBots bots use tabs of their own in your Chrome.
- **Category:** Productivity › Tools
- **Language:** English
- **Description:**

  > OpenBots runs bots on your own computers. With this extension, a bot on
  > this computer can use Chrome the way you would: open pages, read them,
  > click, type and scroll, signed in to the sites you are signed in to.
  >
  > Bots work in tabs of their own, in a window that opens without taking the
  > focus, grouped under each bot's name. Your own tabs stay out of their
  > reach. While a bot works, Chrome shows that OpenBots is controlling the
  > browser; cancel that bar, or press Stop bots in the extension, and every
  > bot stops until you let them go on.
  >
  > Bots read long pages and lists whole, such as a group's members in a
  > dialog, scrolling to the end and keeping every row once.
  >
  > The extension needs the OpenBots app on the same computer
  > (https://openbots.ca). Turn it on in OpenBots' settings, under Browser. It
  > talks only to OpenBots, through Chrome's native messaging, never to a
  > server itself; what bots read goes to the model you chose for them, as
  > https://openbots.ca/privacy/ explains.

- **Icon:** `out/extension/icon.png` (128×128)
- **Screenshots (1280×800):** a bot reading Hacker News and a 1,000-member
  list; OpenBots' settings with the extension's popup.
- **Small promo tile (440×280):** the OpenBots mark and name.
- **Homepage:** https://openbots.ca
- **Support:** https://github.com/smallmodelslab/openbots/issues

## Privacy practices

- **Single purpose:** Let the OpenBots app on this computer use browser tabs
  of its own on the user's behalf.
- **Permissions:**
  - `debugger`: reads the page in a bot's own tab (its accessibility tree,
    text and screenshots) and clicks and types there with trusted input, so a
    bot can use sites as a person does. It attaches only to tabs the bot
    opened.
  - `tabs`: opens, lists, navigates and closes the bots' own tabs, and reads
    their titles and addresses.
  - `tabGroups`: groups each bot's tabs under the bot's name, so the user can
    see which tabs a bot controls.
  - `nativeMessaging`: talks to the OpenBots app on the same computer, the
    only source of commands.
  - `storage`: remembers which tabs belong to which bot, and whether the user
    stopped bots.
  - `alarms`: reconnects to OpenBots after it restarts.
- **Host permissions:** none.
- **Remote code:** No. All code ships in the package; the extension never
  runs code it is sent.
- **Data usage:** Website content (pages' text, outline and pictures) and
  web history (the addresses and titles of the bots' own tabs), from the
  bots' tabs only. They go to the OpenBots app on the same computer for the
  bot that asked, and from there to the model provider the user chose for
  that bot: ChatGPT through the user's own account, or a model they host.
  Certify: not sold to third parties, not used or transferred for purposes
  unrelated to the single purpose, not used to determine creditworthiness or
  for lending. The privacy policy states the Limited Use commitment.
- **Privacy policy:** https://openbots.ca/privacy/

## Distribution

Public, all regions. Submit with publishing deferred, and publish once an
OpenBots release that sets Chrome up is out: older OpenBots has no native
messaging host, so the extension would wait for it.
