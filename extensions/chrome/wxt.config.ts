import { baseManifest, publicDir } from '@prism/extension-shared/manifest';
import { defineConfig } from 'wxt';

export default defineConfig({
	browser: 'chrome',
	manifestVersion: 3,
	publicDir,
	zip: {
		// The Chrome Web Store and "Load unpacked" both take a plain .zip.
		artifactTemplate: '{{name}}-{{packageVersion}}-{{browser}}.zip'
	},
	manifest: {
		...baseManifest,
		// `action.openPopup` (the context menu's "Add to Prism") needs 127+.
		minimum_chrome_version: '127'
	}
});
