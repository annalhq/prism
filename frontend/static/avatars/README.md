# Avatar artwork

`parts.svg` bundles the 200 positioned layers from the `assets/preview` directory of [notion-avatar-svelte](https://github.com/stickerdaniel/notion-avatar-svelte), which credits [Notion Avatar](https://github.com/Mayandev/notion-avatar). Distributed under the included MIT license.

Each layer is a symbol named `category-index` with its original 1080 × 1080 coordinates. IDs inside symbols are namespaced to prevent collisions. Rendering uses the upstream layer order and white base fill, with a neutral background supplied by Prism. The full editor and its dependencies are not included. Keep symbol identities stable: saved person configurations reference these indices.
