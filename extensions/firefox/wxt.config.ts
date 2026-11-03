import { baseManifest, publicDir } from '@prism/extension-shared/manifest';
import { defineConfig } from 'wxt';

export default defineConfig({
	browser: 'firefox',
	manifestVersion: 3,
	publicDir,
	zip: {
		// Firefox installs add-on packages with the .xpi extension.
		artifactTemplate: '{{name}}-{{packageVersion}}-{{browser}}.xpi'
	},
	manifest: {
		...baseManifest,
		browser_specific_settings: {
			gecko: {
				id: 'prism-extension@prism.local',
				strict_min_version: '140.0',
				data_collection_permissions: {
					required: ['authenticationInfo', 'browsingActivity', 'websiteContent', 'websiteActivity']
				}
			}
		}
	}
});
