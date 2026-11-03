# Prism Chrome Extension

Chrome extension for saving the current page or an X/Twitter post to Prism. It is the same
extension as the Firefox one: the code lives in [`../shared`](../shared), and this package holds
only the Chrome manifest settings and entrypoints. It also works in other Chromium browsers
(Edge, Brave, Arc, Vivaldi). Chrome 116 or newer is required.

From the repository root:

```sh
bun run dev:chrome     # opens a Chrome profile with the extension loaded and live reload
bun run build:chrome   # → extensions/chrome/.output/chrome-mv3
bun run zip:chrome     # → extensions/chrome/.output/prism-extension-chrome-<version>-chrome.zip
```

Connect it from Prism's Account panel by generating a pairing code and entering it in the toolbar
popup. Chrome asks for access to your Prism site the first time; codes expire after the selected
interval and work once. Revoke the connection from Prism at any time. The extension keeps its
revocable bearer credential in Chrome extension storage.

The suggested `Alt+Shift+P` shortcut opens the capture popup. Change it at
`chrome://extensions/shortcuts`.

## Installing

### Load unpacked (personal use)

1. `bun run build:chrome`
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick `extensions/chrome/.output/chrome-mv3`.

It stays installed across restarts. After rebuilding, press the reload icon on the Prism card.
Unpacked extensions get an ID derived from the folder path, so keep loading it from the same
folder to keep your pairing.

### Chrome Web Store

Run `bun run zip:chrome` and upload the `.zip` in the
[Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole). Bump the
version first (`bun run release` bumps every extension package together); the store rejects a
version it has already seen.

## Releases

Pushing a version tag (`bun run release && git push --follow-tags` from the repository root)
makes GitHub Actions rebuild this extension and attach the `.zip` to the tag's GitHub Release.
See [`.github/workflows/release.yml`](../../.github/workflows/release.yml).
