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
