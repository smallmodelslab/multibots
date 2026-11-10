# OpenBots artwork

The approved smooth, closed bot face is preserved in `openbots/reference.png`.
Its black contours were traced at a 50% threshold with Potrace (turd size 4,
optimization tolerance 0.08) and normalized to a 128-unit canvas with an
8-unit margin. The SVGs contain paths only; the face interior is transparent.

`openbots/openbots.icon` is the canonical Icon Composer document. It uses the
family's centered 543% scale and Liquid Glass treatment: black on white in
light mode, white on black in dark mode. `openbots/exports/` contains all seven
flattened images from Icon Composer's All platforms / All appearances export:
default, dark, tinted light/dark, clear light/dark, and watchOS.

Regenerate with `python3 infra/branding/generate.py openbots` at the monorepo
root. This also updates the flat SVGs, compiled macOS catalog, ICNS, PNG, ICO,
renderer favicon, and `build/icon.icon`. Electron packages the Composer document
on macOS; Linux and the native window use the generated PNG. The build assets
are part of the native update contract, so changing the icon requires a new
installer rather than only a JavaScript update.
