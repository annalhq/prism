# Theming

Prism's appearance is set by small JSON files. A **theme** replaces the colours, and can also change shapes and type. A **module** is a partial file that stacks on top of whichever theme is active. Both are installed in **Settings → Appearance** and sync to every device signed in to your library.

Two themes are built in: **Zen dark** (the default) and **Zen light**.

## Install

- **Gallery**: Settings → Appearance → _More themes_. Includes Kanagawa, Gruvbox and Catppuccin, plus a few modules. A gallery file is downloaded once, when you install it.
- **Your own file**: _Add theme or module_, or drop one or more `.json` files onto the Appearance pane. Installing a file with the same kind and name as an installed one replaces it.
- **Manage**: click a theme to use it. Right-click a theme or module to export or remove it, or to move a module up or down. Use a module's switch to turn it on or off.

To start a new theme, right-click **Zen dark** or **Zen light** and choose _Export_. You get a minimal starter file to edit and drop back in.

## File format

```json
{
  "$schema": "/themes/theme.schema.json",
  "prism": 1,
  "kind": "theme",
  "name": "Kanagawa Wave",
  "author": "rebelot/kanagawa.nvim",
  "scheme": "dark",
  "palette": {
    "background": "#1F1F28",
    "foreground": "#DCD7BA",
    "accent": "#7E9CD8",
    "danger": "#E82424",
    "warning": "#FF9E3B"
  },
  "colors": { "field": "#2A2A37", "line": "#363646" },
  "shape": { "radius": { "control": 8, "card": 12 } },
  "typography": { "sans": "Inter", "mono": "JetBrains Mono", "scale": 1 }
}
```

| Key           | Required    | Description                                                                                      |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `prism`       | yes         | Format version. Always `1`.                                                                      |
| `kind`        | no          | `"theme"` (default) or `"module"`.                                                               |
| `name`        | yes         | Up to 64 characters. Unique per kind.                                                            |
| `author`      | no          | Up to 120 characters.                                                                            |
| `description` | no          | Up to 160 characters. Shown under modules.                                                       |
| `scheme`      | themes only | `"dark"` or `"light"`. Picks the Zen base and the light/dark rules (glass, menus, avatars).      |
| `palette`     | no          | Five-colour shorthand; `background` and `foreground` are required inside it. See below.          |
| `colors`      | no          | Exact values for individual tokens. Wins over `palette`.                                         |
| `shape`       | no          | `radius.sm`, `radius.control`, `radius.card`, `radius.panel` in px (0–40).                       |
| `typography`  | no          | `sans`, `mono`, `display`: installed font families; `scale`: 0.85–1.25 multiplier for all sizes. |

The `$schema` key is ignored by Prism. Point it at `https://<your-prism-host>/themes/theme.schema.json` to get completion and validation in your editor.

## Palette

`palette` is the quickest way to port a colour scheme. Prism derives every surface, text tone, line and control colour from `background`, `foreground` and `accent`, with separate mixes for dark and light schemes. `danger` and `warning` are optional. Fine-tune any derived value with `colors`.

## Colour tokens

| Token                                                      | Paints                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| `canvas`                                                   | Page background; also the browser's theme colour.          |
| `surface`, `sheet`, `card`                                 | Panels, sheets and cards on the canvas.                    |
| `field`, `elevated`                                        | Inputs and raised layers (menus, dialogs, the active row). |
| `hover`, `active`, `pressed`, `selection`                  | Interaction states and selected rows.                      |
| `ink`, `muted-ink`, `secondary`, `tertiary`                | Text, from primary to quiet metadata.                      |
| `line`, `hairline`, `highlight`                            | Borders, dividers and inner sheens.                        |
| `accent`, `accent-hover`, `on-accent`                      | Primary buttons and the text on them.                      |
| `danger`, `warning`                                        | Destructive actions and warnings.                          |
| `scrim`                                                    | Overlay behind dialogs.                                    |
| `shadow-faint`, `shadow-soft`, `shadow-strong`             | Shadows.                                                   |
| `switch-off`, `switch-knob`, `switch-on`, `switch-on-knob` | Toggle switches.                                           |
| `cover-glow`, `cover-base`                                 | Person page covers.                                        |
| `warm-white`                                               | Glass sheens and text on gradients.                        |

Colours may be hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()` or `transparent`.

## Modules

A module has `"kind": "module"` and no `scheme`. It may set any of `palette`, `colors`, `shape` and `typography`; a module palette is derived for the active theme's scheme.

```json
{
  "prism": 1,
  "kind": "module",
  "name": "Rounded",
  "description": "Softer, rounder corners",
  "shape": { "radius": { "sm": 8, "control": 14, "card": 20, "panel": 26 } }
}
```

### Stacking order

Layers apply in this order, and the last value set for a token wins:

1. Zen dark or Zen light, chosen by the theme's `scheme`
2. The theme's `palette`
3. The theme's `colors`, `shape` and `typography`
4. Each enabled module, top to bottom, in the same order

The **Square corners** setting always overrides radii from themes and modules.

## Limits and safety

- Files must be valid JSON under 16 KB. Unknown keys are rejected, with the exact path in the error (for example `colors.canvas: not a colour`).
- Only the tokens listed above can be set, and values are checked before use. Prism never inserts CSS from a file.
- Fonts must be installed on the device. Remote fonts are not supported; an unavailable family falls back to the system font. The bundled `STK Bureau Sans`, `STK Bureau Sans Semi Mono` and `STK Bureau Serif` are always available.
- Contrast is your responsibility. The built-in and gallery themes keep text readable; check your own on both the canvas and raised surfaces.

## Performance

- The active theme compiles to one small block of CSS variables, about 1 KB.
- That CSS is cached on the device and applied before the first paint, so pages never flash or wait for a theme to load.
- Installed themes travel with your library sync, so no theme files are downloaded on page load.
- Gallery files are fetched only when you install from the gallery.

## Contributing a gallery theme

Add the file to `frontend/static/themes/` and an entry to `frontend/static/themes/index.json`. The schema in `theme.schema.json` is generated from the token registry in `frontend/src/lib/domain/theme.ts`; run `bun run themes:schema` after adding tokens.
