# Prism

A private personal knowledge library for saved content, people and connections.

| Path         | Purpose                                       |
| ------------ | --------------------------------------------- |
| `frontend/`  | SvelteKit web app and database tooling        |
| `extension/` | Firefox extension for page and X post capture |

## Develop

Requires Node 22.17+ and Bun 1.4.0.

```sh
bun install --frozen-lockfile
cp frontend/.env.example frontend/.env
bun run dev
```

## Commands

| Command                   | Purpose                                     |
| ------------------------- | ------------------------------------------- |
| `bun run dev`             | Development server                          |
| `bun run build`           | Production build                            |
| `bun run check`           | Type checks                                 |
| `bun run lint`            | Prettier and ESLint                         |
| `bun run format`          | Apply formatting                            |
| `bun run test`            | Unit tests                                  |
| `bun run db:generate`     | Generate SQL from the Drizzle schema        |
| `bun run db:migrate`      | Apply migrations                            |
| `bun run db:init-owner`   | Initialize the owner vault                  |
| `bun run dev:extension`   | Run the extension in development mode       |
| `bun run build:extension` | Build the extension                         |
| `bun run sign:extension`  | Sign the extension through AMO (see below)  |

## Firefox extension

1. Bump `version` in `extension/package.json`.
2. Put AMO API keys from <https://addons.mozilla.org/developers/addon/api/key/> in `extension/.env`:

   ```sh
   WEB_EXT_API_KEY=user:...
   WEB_EXT_API_SECRET=...
   ```

3. Run `bun run sign:extension`.
4. In Firefox, open `about:addons` → ⚙ → **Install Add-on From File…** and pick the `.xpi` from `extension/.output/signed/`.

Pair it from Prism's Account panel by entering the generated code in the extension popup.

## Deploy

Vercel builds from the repository root using `vercel.json`.
