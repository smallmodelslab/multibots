# Pencil and chalk strokes

Shared decorative CSS for the pencil alternative in [UI.md](../../UI.md#pencil-alternative).
No runtime, fonts or external assets. Both applications consume the same masks.

Import `@wrkrsh/pencil/pencil.css` in a web app. Embedded hosts can concatenate
`pencil.css` before their own stylesheet, as Multidesktop's `cloud-core/src/web.rs`
does. The data-URI masks need `data:` allowed by the host's `img-src` CSP.

- `.pencil-outline`: absolute border layer inside a positioned, rounded parent.
- `.chalk-outline`: broader, porous border with a faint dust edge.
- `--chalk-rule` and `--chalk-grain`: chalk masks for host pseudo-elements.
- `.pencil-line`: a coloured, tapered rule; the caller supplies its size/position.
- `.pencil-mark`: paper tooth for a decorative SVG path.
- `--pencil-rule`: the complete pressure/texture mask for host pseudo-elements.
- `--pencil-line-mask` and `--pencil-grain`: the underlying pressure and paper masks.

Colour comes from `currentColor`; text and controls never go inside a textured
layer. Grain is deterministic and never animates. Forced colours removes the
texture from the shared classes; hosts using the variables provide a solid rule.

Chalk follows the same theme tokens in both modes: dark on light, light on dark.
Keep the surface colour and all text untextured.
