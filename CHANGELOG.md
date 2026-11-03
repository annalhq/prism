# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.2.0](https://github.com/annalhq/prism/compare/v0.1.0...v0.2.0) (2026-11-03)

### ⚠ BREAKING CHANGES

* **extension:** add Chrome extension support
* **ui:** redesign landing and auth page
* **storage:** replace Backblaze B2 with Neon object storage

### Features

* add profile pics from api and backblaze support ([d4f02ea](https://github.com/annalhq/prism/commit/d4f02eadc8e8e4e34831c7cb68d53e97066d35a7))
* **ci:** automate release notes and draft GitHub releases ([91fb8a7](https://github.com/annalhq/prism/commit/91fb8a7866e259bb07e12c9463db9a6dd5abd51f))
* **extension:** add Chrome extension support ([dd265db](https://github.com/annalhq/prism/commit/dd265dbc1aeaf0085a9cb2c6b1b2a19dd6bb6856))
* **notes:** add Markdown text notes and rich previews ([2bbb765](https://github.com/annalhq/prism/commit/2bbb765dcba37b25a41e243e936aa0f1d4827d80))
* **perf:** add reproducible library performance benchmarks ([f42237b](https://github.com/annalhq/prism/commit/f42237bfba029efe240f3450e4a74492672b99ae))
* **profile:** support multiple social avatar providers ([3f50296](https://github.com/annalhq/prism/commit/3f50296a00d3c818ebcce378ee86a2e54392bb64))
* **stash:** add hierarchical rabbit holes for linked bookmarks ([f93159d](https://github.com/annalhq/prism/commit/f93159dbaf5a9d3e366e4d824d52bdc894ed16c0))
* **tags:** manage public visibility in edit dialog ([d3855d6](https://github.com/annalhq/prism/commit/d3855d6b0879c039fb0b1ce7f5477818e79507bd))
* **twitter:** add bookmark button support for OldTwitter ([20429ce](https://github.com/annalhq/prism/commit/20429ce0b967d0a0d13de1632f6f43592b92d8fd))
* **ui:** redesign account panel ([0aea2f2](https://github.com/annalhq/prism/commit/0aea2f2cd6bdb14f545bec728a67b4d1272bfb8b))
* **ui:** redesign landing and auth page ([76a6b5f](https://github.com/annalhq/prism/commit/76a6b5f3d08174c140d17330a9d32a5a104ca6af))
* **ui:** redesign mobile navbar ([3f10437](https://github.com/annalhq/prism/commit/3f10437c3377e1d00d1fe9cc73eaf5ba894fa2f5))
* **ui:** redesign Omnibar ([835feb9](https://github.com/annalhq/prism/commit/835feb9b2c64082a14b468d3f521288c2dc901fd))
* **ui:** redesign the auth layour and screen ([6edee2b](https://github.com/annalhq/prism/commit/6edee2b034cec0ee825b9dfc8e13f2bc83aaba3c))
* **ui:** redesign the context menu ([6dac2fc](https://github.com/annalhq/prism/commit/6dac2fc7e409d80d29eff061c89c975844146e3f))
* **ui:** redesign the person's page ([ca81857](https://github.com/annalhq/prism/commit/ca81857a0af4cea5f0c04fbd82434d3450e279ec))
* **ui:** refine typography, mobile bookmarks, and visual design ([612645c](https://github.com/annalhq/prism/commit/612645c56e6e85da64b79bdb370b1342dfd21a68))
* **ui:** rehaul bookmark editor ([e628f76](https://github.com/annalhq/prism/commit/e628f764022a0614cada66326b5a236c455640a2))

### Bug Fixes

* [#1](https://github.com/annalhq/prism/issues/1) resolves styling for dropdown in person selection ([68a5d85](https://github.com/annalhq/prism/commit/68a5d857c36c87c79a5bc90d6be54854a9c89c0a))
* **#3:** add -webkit-tap-highlight-color: transparent for mobile view ([dc841ce](https://github.com/annalhq/prism/commit/dc841ce8e4334a9bf5e12d04839153edd5ea7d96)), references [#3](https://github.com/annalhq/prism/issues/3)
* **editor:** edit link option ([cb5e6ce](https://github.com/annalhq/prism/commit/cb5e6ceaea7953ecab390ab540d31a7b453f8ecc))
* explain missing photos in avatar and photo API responses ([3b1498c](https://github.com/annalhq/prism/commit/3b1498c3bf6e97c65955383ca6e3f7683c92b32b))
* **feed:** remove duplication of profile on cards ([e3b65a8](https://github.com/annalhq/prism/commit/e3b65a835b65bd6c0988b7a67cbc8a350b860a71))
* improve avatar upload diagnostics and reduce wasted lookup quota ([514e886](https://github.com/annalhq/prism/commit/514e8861431533ebe202d2980f5ee341cb70ee3a))
* **LibraryWorkspace popup:** match the styling ([bdd68cf](https://github.com/annalhq/prism/commit/bdd68cfc84f6926ce28773e8729dc74a5da0f578))
* **sidebar:** highlight now only goes to normal rows ([9795933](https://github.com/annalhq/prism/commit/9795933d7ff02d01145fddd1c3cd73f123d43155))
* smooth omnibar state and sign-in transitions ([c66f46f](https://github.com/annalhq/prism/commit/c66f46fccb05e43c4931bed542c81b2143d75093))
* **ui:** resolve omnibar and mobile layout issues ([7537754](https://github.com/annalhq/prism/commit/7537754ee5e23b07725fdb5f83be7a85aa008d56))

### Performance

* **bootstrap:** batch library queries to reduce database round trips ([b49f9fe](https://github.com/annalhq/prism/commit/b49f9fe55ed5a205f4c6861636bfe16bc11964cc))
* **markdown:** replace Sätteri with TanStack Markdown ([fa29cef](https://github.com/annalhq/prism/commit/fa29cef4bb19097ee390dd25219d23a4430c2f28))
* **search:** cache worker snapshots and lazy-load import/export ([a0038ae](https://github.com/annalhq/prism/commit/a0038aea37a99b52e5ed45d67acf5dc3fd5aa8c2))
* **sync:** batch bootstrap downloads across tables ([a04db6e](https://github.com/annalhq/prism/commit/a04db6e226bf38e91a30e6d979db3e068b2f1006))
* **sync:** optimize idle polling and cross-tab updates ([bffeb42](https://github.com/annalhq/prism/commit/bffeb423c219c462b754b59c321e53a1f1d1ff11))

### Refactoring

* **storage:** replace Backblaze B2 with Neon object storage ([11a0d95](https://github.com/annalhq/prism/commit/11a0d95c42f390ec503aa0643dd9b237383cd7fe))
* **ui:** use icon for 'enter' and simplify shortcut kbd in context ([019aa49](https://github.com/annalhq/prism/commit/019aa49cfddd4d1ee95a925cf39891054034f877))

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
