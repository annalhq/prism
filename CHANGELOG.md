# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## 0.1.0 (2026-10-28)

### ⚠ BREAKING CHANGES

* implement caching for bookmarks
* **library:** personas/knowledge contexts, person association roles and the reading-status search filters were removed
* resolve tag handling, deletion flows, and UI interaction bugs

### Features

* add dedicated Tags explorer page ([f6da2c3](https://github.com/annalhq/prism/commit/f6da2c309effc074d1731bebc9c7fb72b211768f))
* add light theme and improve mobile navigation and capture UX ([567b01c](https://github.com/annalhq/prism/commit/567b01ce14df5f911e3207f6bd8120aee290bbde))
* add tweet cards and automatic tweet tagging ([19d243c](https://github.com/annalhq/prism/commit/19d243c43326ff9e5c9792b08ef6f665948b553d))
* **backend:** add Neon schema and owner authentication ([65caf57](https://github.com/annalhq/prism/commit/65caf577f982de2f6fe3aca36ec07004d5d96cca))
* **backend:** add organization commands for tags, collections, saved searches and activity ([4aab655](https://github.com/annalhq/prism/commit/4aab655e8dc1700fb8a24cbe94635fc96895bd8d))
* **backend:** add people profiles, confirmed identities and content roles ([6bfe03e](https://github.com/annalhq/prism/commit/6bfe03e6abc0eff347c41993a58e5c33743f3cfe))
* **backend:** add shared notes, typed references and backlink reads ([d4bbe87](https://github.com/annalhq/prism/commit/d4bbe879fc2be1f7d1caa021e17711f576639934))
* **backend:** bookmarks commands with idempotent retry ([5a8ee80](https://github.com/annalhq/prism/commit/5a8ee801f9c88f0ab1f25c09cea994f587be45a6))
* **branding:** add logo, favicons and social share metadata ([b43ca0c](https://github.com/annalhq/prism/commit/b43ca0c35d017eb98a050a6661fe87a9d558cbdf))
* **capture:** add auto-title metadata extraction to picker ([661978e](https://github.com/annalhq/prism/commit/661978e6f88d1485c564f4d0d1c99afcdefded42))
* expanded inline bookmark view for notes ([12b8eda](https://github.com/annalhq/prism/commit/12b8eda653df6898940c11c7b4299da21fbb2a9d))
* **extension:** add Firefox page and X post capture with pairing auth ([2d72ecd](https://github.com/annalhq/prism/commit/2d72ecd8319b348e7edc2d9ada9f293811b1760d))
* **extension:** queue saves offline and rebuild the capture form ([1af8bdc](https://github.com/annalhq/prism/commit/1af8bdc483e3aaed508e0b760fad7a82a724cd2f))
* **favicons:** discover page icons with lazy loading and blank-icon fallback ([d5bbe60](https://github.com/annalhq/prism/commit/d5bbe60dbd8471ecef2d34408842e695cbbd7141))
* implement caching for bookmarks ([f31f184](https://github.com/annalhq/prism/commit/f31f184c16ae94e0c7057d13be25130bad88cd84))
* implement static favicons for twitter & youtube ([eb24142](https://github.com/annalhq/prism/commit/eb2414216666cc65e741e50a6fe602c8e940f346))
* improve title fetching, favicons, and tag reordering ([6240191](https://github.com/annalhq/prism/commit/6240191ed7d44d20fe374710100cb8726986abb8))
* init baseline sveltekit ([8b7d3ff](https://github.com/annalhq/prism/commit/8b7d3ffd8708a2272515df3d25b37eb29a47c29c))
* **library:** drop pin and archive, add permanent delete ([b47d6a4](https://github.com/annalhq/prism/commit/b47d6a4212a041af97b5fc5359274bd03b9674b1))
* **library:** streamline workflows and add person timeline pages ([198490f](https://github.com/annalhq/prism/commit/198490f32083f5c1485fe6908819fbf7db7a5f57))
* **monorepo:** restructure repository into Bun workspaces ([07d86a4](https://github.com/annalhq/prism/commit/07d86a440b2e2662aee6208cf69b91ccb09fd577))
* **people:** add social feed, profile links, and person search ([113d44b](https://github.com/annalhq/prism/commit/113d44b7374e4c46366a220f032712d0d8113d64))
* **perf:** optimize save and syncing behaviour ([2899d72](https://github.com/annalhq/prism/commit/2899d72dcc346f1b5b8f391197fecbcaf70e5ce4))
* **public:** add opt-in read-only library view ([54a062f](https://github.com/annalhq/prism/commit/54a062fdf75ce7b9979377da50ae864b559b5b3a))
* rebuild people, feed, and tags pages ([82b81d3](https://github.com/annalhq/prism/commit/82b81d3b4c5bc9dba3fc97dcfd4b8a4c6f501825))
* redesign authentication, typography, mobile navigation, and settings ([4a1008a](https://github.com/annalhq/prism/commit/4a1008af7364df1246ed67af9d80f695c69eec97))
* redesign edit form, sidebar, and tag popups ([1038184](https://github.com/annalhq/prism/commit/10381849d22c0f24740e58a07d59abd488816753))
* redesign landing, auth, toasts, and capture flow ([9e112ba](https://github.com/annalhq/prism/commit/9e112ba6197bb26d172b9cdf4b24dcbb620ee3c7))
* refine people feed, menus, extension, and settings ([a9663bd](https://github.com/annalhq/prism/commit/a9663bd4597c107534e2ed7bdece7c2f414f6ffe))
* **ui:** add subtle sound cues and refresh design tokens — sounds.svelte.ts, cuelume dep, AccountPanel.svelte, app.css, AuthScreen.svelte, TokenInput.svelte, +layout.svelte ([9792889](https://github.com/annalhq/prism/commit/97928892f479a79ddeaf1b9ff150b2afbd24cc79))
* **ui:** adopt a dark theme, Geist typeface and Lucide icons ([ee01d47](https://github.com/annalhq/prism/commit/ee01d47ac06a0c86691c411441d4b20437913d8d))
* **ui:** fix design system ([8995de4](https://github.com/annalhq/prism/commit/8995de49311994a0a42ae77f76f283b16098a30f))
* **ui:** omnibar ui rehaul ([34595d0](https://github.com/annalhq/prism/commit/34595d0cb40f0bf75fffe29e185cc97394861175))
* **ui:** refine navigation and bookmark layouts ([cf4d952](https://github.com/annalhq/prism/commit/cf4d952e00fc05ac535cce4715d0bbcb8a581b20))
* **ui:** refresh interface with sign-in-first shell and shared controls ([bf8e6e3](https://github.com/annalhq/prism/commit/bf8e6e395151ae614ca3dac07c3b880a1d17b5d0))
* **workspace:** add offline library workspace with sync and personas ([b5c4c3d](https://github.com/annalhq/prism/commit/b5c4c3d1fefab5dde67393db30e3fb0e7bae8a7f))

### Bug Fixes

* apply missing avatar schema migration and improve error diagnostics ([e997594](https://github.com/annalhq/prism/commit/e9975949c7207bb4d28316ed08b672cabacfba99))
* configure Vercel adapter for SvelteKit ([576438c](https://github.com/annalhq/prism/commit/576438ce6b0cb358f9a96afc866a5a76075f8299))
* **db:** apply missing tag position migration ([81491cb](https://github.com/annalhq/prism/commit/81491cbc9074d9a518749242647f52167eb1765c))
* **extension:** add missing protocolVersion to the payload ([f2b581a](https://github.com/annalhq/prism/commit/f2b581ab9f4c7d6ed72ec63f6bef08f52ecceb2f))
* **extension:** resolve account pane overflow and pairing errors ([3cc2be7](https://github.com/annalhq/prism/commit/3cc2be7c9e5f41536a3d1fe086ba9b72930ef8e1))
* library shell improvements ([eba7ad6](https://github.com/annalhq/prism/commit/eba7ad6591d1b73c35d1b0c9b0a098ba05e48861))
* **library:** snapshot avatar config before saving person command ([2fcb25d](https://github.com/annalhq/prism/commit/2fcb25d53dc7ca32d3cfa7aeccb6157604d3b21e))
* resolve tag handling, deletion flows, and UI interaction bugs ([37c68d3](https://github.com/annalhq/prism/commit/37c68d3c55fa89da05abddc948fa8af1ed256f8f))
* restore AsciiOcean landing background ([c84e367](https://github.com/annalhq/prism/commit/c84e3674bb6401987148626cfc9351ffeecfc3d2))
* **ui:** align omnibar and sidebar menu ([725af88](https://github.com/annalhq/prism/commit/725af888c7d0be8ab1b6f4e76817fb2a6dc0eca9))
* **ui:** clean the irrelevant texts ([25da82e](https://github.com/annalhq/prism/commit/25da82ef7b94a95e2166b00e8d0003698d7edcaf))
* **ui:** remove Collapsible trigger ([ef06328](https://github.com/annalhq/prism/commit/ef06328782f7eaddc1163ce75580b14ff1e231de))

### Refactoring

* **auth:** replace forgot-password accordion with inline form mode ([c340c80](https://github.com/annalhq/prism/commit/c340c80ce2d2eb5cacd9bc5a0d2172669700cbd8))
* **metadata:** modify site metadata ([7d4089f](https://github.com/annalhq/prism/commit/7d4089f5705b867ff3bba5b5785e462d992d0977))
* **svelte:** simplify reactive state and remove duplication ([249d8ef](https://github.com/annalhq/prism/commit/249d8efa418a29b98ddb79d164da2515899c0122))

### Styling

* **auth:** simplify login form typography and icons ([010d1c9](https://github.com/annalhq/prism/commit/010d1c9499322739b132d61c213ce76d7a1f8689))
