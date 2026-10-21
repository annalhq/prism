import { defineConfig } from 'wxt';

export default defineConfig({
	zip: {
		// Firefox installs add-on packages with the .xpi extension.
		artifactTemplate: '{{name}}-{{packageVersion}}-{{browser}}.xpi'
	},
	manifest: {
		name: 'Prism',
		description: 'Save pages and X posts to your Prism library.',
		permissions: ['storage', 'activeTab', 'alarms'],
		host_permissions: ['https://x.com/*', 'https://twitter.com/*'],
		optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
		web_accessible_resources: [
			{
				resources: ['geist-latin-wght-normal.woff2'],
				matches: ['https://x.com/*', 'https://twitter.com/*']
			}
		],
		action: { default_title: 'Save to Prism', default_popup: 'popup.html' },
		commands: {
			_execute_action: {
				suggested_key: { default: 'Alt+Shift+P' },
				description: 'Open the Prism capture form'
			}
		},
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
