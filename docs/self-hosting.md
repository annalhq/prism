# Self-host Prism

[Back to Prism](../.github/README.md)

Prism runs with one owner per deployment. You’ll need Bun 1.4, Node.js 22.17 or later, and a Neon project with Neon Auth enabled. Use a fresh database for a new library.

## Run locally

Clone the repository, install the dependencies, and copy the environment template.

```sh
git clone https://github.com/annalhq/prism.git
cd prism
bun install --frozen-lockfile
cp frontend/.env.example frontend/.env
```

Create the account you’ll use to sign in in Neon Auth. Fill in the following values in [`frontend/.env`](../frontend/.env.example).

| Variable                  | Value                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | Pooled Neon connection string for the app                                                |
| `DATABASE_URL_DIRECT`     | Direct connection string for the same database, used by the setup and migration commands |
| `APP_ORIGIN`              | `http://localhost:5173` for local development                                            |
| `NEON_AUTH_BASE_URL`      | HTTPS URL for Neon Auth                                                                  |
| `NEON_AUTH_COOKIE_SECRET` | A random secret of at least 32 characters                                                |
| `OWNER_SUBJECT`           | The Neon Auth user ID of the account you created                                         |

Initialize the database and start Prism.

```sh
bun run db:inventory
bun run db:migrate
bun run db:init-owner
bun run dev
```

Open [localhost:5173](http://localhost:5173) and sign in with your Neon Auth account.

## Deploy to Vercel

Run the database setup commands against the database your deployment will use. Import the repository into Vercel with the repository root as the project directory. The install and build commands are already set in [`vercel.json`](../vercel.json).

Set `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, and `OWNER_SUBJECT` in the Vercel project. Set `APP_ORIGIN` to your deployment’s HTTPS origin without a trailing slash. Trigger the deployment manually because the project configuration disables automatic Git deployments from `main`.

## Optional settings

| Variable              | Effect                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `LIBRARY_PUBLIC_VIEW` | Set to `enabled` to publish a read-only library at `/public`. Private tags and items carrying them are excluded.      |
| `NEON_STORAGE_*`      | Set the values in the [environment template](../frontend/.env.example) to use Neon Object Storage for profile photos. |

## Upgrade an existing library

Check the [changelog](../CHANGELOG.md) for release notes. Back up your database or create a Neon branch before applying migrations. From the new checkout, install dependencies and run the inventory and migration against the same database.

```sh
bun install --frozen-lockfile
bun run db:inventory
PRISM_CONFIRM_UPGRADE=1 bun run db:migrate
```

Restart or redeploy Prism after the migration finishes.
