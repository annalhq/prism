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
		// Service-worker `alarms`, `optional_host_permissions` and promise-based APIs need 116+.
		minimum_chrome_version: '116'
	}
});
