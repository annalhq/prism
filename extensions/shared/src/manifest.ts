import { fileURLToPath } from 'node:url';

/** Icons and fonts both browser builds ship. Pass as WXT's `publicDir`. */
export const publicDir = fileURLToPath(new URL('../public', import.meta.url));

const xHosts = ['https://x.com/*', 'https://twitter.com/*'];

/** Manifest fields shared by every browser. Each package adds its browser-specific keys. */
export const baseManifest = {
	name: 'Prism',
	description: 'Save pages and X posts to your Prism library.',
	permissions: ['storage', 'activeTab', 'alarms'],
	host_permissions: xHosts,
	optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
	web_accessible_resources: [
		{
			resources: ['libre-franklin-latin-wght-normal.woff2', 'stk-bureau-serif-book.woff2'],
			matches: xHosts
		}
	],
	action: { default_title: 'Save to Prism', default_popup: 'popup.html' },
	commands: {
		_execute_action: {
			suggested_key: { default: 'Alt+Shift+P' },
			description: 'Open the Prism capture form'
		}
	}
};
