# Contributing to Prism

[Back to Prism](README.md)

[Open an issue](https://github.com/annalhq/prism/issues/new) to report a bug or discuss a larger change. For a bug, include your Prism version, browser, and steps to reproduce it.

## Develop locally

Follow the [local setup guide](../docs/self-hosting.md#run-locally). The [web app](../frontend) uses SvelteKit and PostgreSQL. The [browser extensions](../extensions) use WXT.

Run these commands from the repository root.

| Command                    | Purpose                           |
| -------------------------- | --------------------------------- |
| `bun run dev`              | Start the web app                 |
| `bun run check`            | Type-check the app and extensions |
| `bun run lint`             | Check formatting and lint         |
| `bun run test`             | Run the web app’s unit tests      |
| `bun run dev:firefox`      | Develop the Firefox extension     |
| `bun run dev:chrome`       | Develop the Chrome extension      |
| `bun run build:extensions` | Build both extensions             |

Run the checks relevant to your change before opening a pull request, and include screenshots for visible changes. Use [Conventional Commits](https://www.conventionalcommits.org/) so changes are grouped correctly in release notes.

To contribute a theme, follow the [gallery instructions](theming.md#contributing-a-gallery-theme).
