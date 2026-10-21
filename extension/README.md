# Prism Firefox Extension

Firefox extension for saving the current page or an X/Twitter post to Prism.

From the repository root:

```sh
bun run dev:extension
bun run build:extension
bun run zip:extension
```

Connect it from Prism's Account panel by generating a pairing code and entering it in the toolbar popup. Codes expire after the selected interval and work once. The saved connection can read tag/person names and create bookmarks; revoke it from Prism at any time. The extension stores its revocable bearer credential in Firefox extension storage.

The suggested `Alt+Shift+P` shortcut opens the capture popup. Change it in `about:addons` → Extensions → Manage Extension Shortcuts.

## Building an installable `.xpi`

```sh
bun run zip:extension
```

This writes `extension/.output/prism-extension-0.0.0-firefox.xpi`. The version comes from
`extension/package.json`; bump it for every release (AMO rejects re-uploading an existing
version). The icons are generated from the repository's `logo.svg` and live in
`extension/public/icon/` (`16`, `32`, `48`, `96`, `128` px).

## Installing permanently in Zen

An add-on loaded through `about:debugging` is a *temporary* add-on and disappears on
restart. Installing an `.xpi` makes it permanent. Zen (like Firefox) normally only accepts
Mozilla-signed packages, so pick one of these:

### Option A — sign it, then install (recommended, no browser config)

Sign the package through Mozilla's Add-ons site as an **unlisted** (self-distributed)
add-on. It can still be installed from a file; it does not have to be listed publicly.

1. Create API keys at <https://addons.mozilla.org/developers/addon/api/key/>.
2. Run:

   ```sh
   export WEB_EXT_API_KEY='user:...'
   export WEB_EXT_API_SECRET='...'
   bun run sign:extension
   ```

   The signed `.xpi` is written to `extension/.output/signed/`.

   Alternatively, use the AMO web UI: submit at
   <https://addons.mozilla.org/developers/addon/submit/distribution>, choose
   **On your own**, upload the `.xpi`, and download the signed copy once review finishes.

3. In Zen open `about:addons` → gear icon → **Install Add-on From File…** and pick the
   signed `.xpi`.

### Option B — allow unsigned add-ons in Zen

Use this for local/personal builds. In Zen's `about:config`:

| Preference | Value | Why |
| --- | --- | --- |
| `xpinstall.signatures.required` | `false` | Accepts packages without a Mozilla signature |
| `extensions.autoDisableScopes` | `14` | Keeps profile-installed add-ons enabled across restarts |

Then `about:addons` → gear icon → **Install Add-on From File…** → select
`extension/.output/prism-extension-0.0.0-firefox.xpi`. It stays installed and enabled
across restarts.

Notes:

- Setting `xpinstall.signatures.required` back to `true` will disable the add-on.
- Regular Firefox release builds ignore this preference; Zen, Firefox Developer Edition,
  Nightly, and ESR honour it.
- Unsigned add-ons do not auto-update. Rebuild, bump the version, and reinstall the new
  `.xpi` after changes.
