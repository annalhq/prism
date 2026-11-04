# Prism for Firefox

Save pages and X/Twitter posts to your Prism library without leaving your browser. Add tags, connect people, and queue saves when you're offline. Works with OldTwitter too.

You'll need a running [Prism library](../../.github/README.md#self-hosting) to connect to.

## Install

1. Open [Prism Releases](https://github.com/annalhq/prism/releases) and download the **signed Firefox `.xpi`**, if available.
2. In Firefox, open `about:addons` and click the gear icon.
3. Choose **Install Add-on From File…** and select the downloaded file.

A regular Firefox installation requires a Mozilla-signed package. If the release only includes an unsigned `.xpi`, use the temporary installation below to try it.

## Connect to Prism

1. Sign in to Prism and open **Account**.
2. Generate a pairing code.
3. Click the Prism icon in your browser toolbar, paste the code, and connect.

Pairing codes expire and can only be used once. Generate a new one if needed. You can revoke the connection from Prism's Account panel at any time.

## Save something

- **Any page:** click the Prism toolbar icon or press `Alt + Shift + P`.
- **X/Twitter or OldTwitter:** click the Prism save button on a post.
- **Before saving:** edit the title, add `#tags` or an `@person`, then click **Save**. You can also press `Ctrl + Enter` (`⌘ + Enter` on macOS).

Offline saves are queued and sent when your connection returns.

To change the popup shortcut, open `about:addons` → gear icon → **Manage Extension Shortcuts**.

## Build from source

After completing the [project setup](../../.github/README.md#self-hosting), run these commands from the repository root as needed:

| Command                 | What it does                                    |
| ----------------------- | ----------------------------------------------- |
| `bun run dev:firefox`   | Open Firefox with the extension and live reload |
| `bun run build:firefox` | Build the extension                             |
| `bun run zip:firefox`   | Create an unsigned `.xpi` package               |

### Try a local build

1. Run `bun run build:firefox`.
2. Open `about:debugging` → **This Firefox** → **Load Temporary Add-on…**.
3. Select `extensions/firefox/.output/firefox-mv3/manifest.json`.

Firefox removes temporary add-ons when it restarts.

### Sign a build for permanent installation

Create [Mozilla Add-ons API keys](https://addons.mozilla.org/developers/addon/api/key/) and add them to `extensions/firefox/.env`:

```dotenv
WEB_EXT_API_KEY=user:...
WEB_EXT_API_SECRET=...
```

Run `bun run sign:firefox` from the repository root. Install the signed `.xpi` from `extensions/firefox/.output/signed/` using the steps above. Keep your API keys private.

The extension's shared source lives in [`../shared`](../shared). See also [Prism for Chrome](../chrome/README.md).
