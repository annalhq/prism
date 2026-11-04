# Prism for Chrome

Save pages and X/Twitter posts to your Prism library without leaving your browser. Add tags, connect people, and queue saves when you're offline. Works with [OldTwitter](https://github.com/dimdenGD/OldTwitter), created by [dimden](https://github.com/dimdenGD), too.

Supports Chrome 116+ and other Chromium browsers, including Edge, Brave, Arc, and Vivaldi. You'll need a running [Prism library](../../.github/README.md#self-hosting) to connect to.

## Install

1. Open [Prism Releases](https://github.com/annalhq/prism/releases) and download the **Chrome `.zip`**.
2. Extract the ZIP into a folder you plan to keep.
3. Open `chrome://extensions` and turn on **Developer mode**.
4. Click **Load unpacked** and select the extracted folder containing `manifest.json`.

Keep that folder in place: Chrome loads the extension from it. In other Chromium browsers, use their extensions page and the same **Load unpacked** option.

## Connect to Prism

1. Sign in to Prism and open **Account**.
2. Generate a pairing code.
3. Click the Prism icon in your browser toolbar, paste the code, and connect.
4. Allow access to your Prism site when the browser asks.

Pairing codes expire and can only be used once. Generate a new one if needed. You can revoke the connection from Prism's Account panel at any time.

## Save something

- **Any page:** click the Prism toolbar icon or press `Alt + Shift + P`.
- **X/Twitter or OldTwitter:** click the Prism save button on a post.
- **Before saving:** edit the title, add `#tags` or an `@person`, then click **Save**. You can also press `Ctrl + Enter` (`⌘ + Enter` on macOS).

Offline saves are queued and sent when your connection returns.

To change the popup shortcut, open `chrome://extensions/shortcuts`.

## Update

Download the new Chrome ZIP from [Releases](https://github.com/annalhq/prism/releases), extract it, and replace the files in the folder you originally loaded. Then open `chrome://extensions` and click **Reload** on the Prism card.

Use the same folder to preserve your pairing. Updates to an unpacked extension are manual.

## Build from source

After completing the [project setup](../../.github/README.md#self-hosting), run these commands from the repository root as needed:

| Command                | What it does                                   |
| ---------------------- | ---------------------------------------------- |
| `bun run dev:chrome`   | Open Chrome with the extension and live reload |
| `bun run build:chrome` | Build the extension                            |
| `bun run zip:chrome`   | Create a ZIP package                           |

To install a local build, use **Load unpacked** and select `extensions/chrome/.output/chrome-mv3`. After rebuilding, click **Reload** on the Prism card.

The extension's shared source lives in [`../shared`](../shared). See also [Prism for Firefox](../firefox/README.md).
