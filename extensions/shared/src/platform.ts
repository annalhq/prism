/**
 * Browser-specific wording, fixed at build time. WXT sets `import.meta.env.FIREFOX` / `CHROME`
 * for the target passed to `wxt -b <browser>`, so each package only bundles its own strings.
 */
export const browserId: 'firefox' | 'chrome' = import.meta.env.FIREFOX ? 'firefox' : 'chrome';

export const browserName = import.meta.env.FIREFOX ? 'Firefox' : 'Chrome';

/** Where the user reloads or manages the extension. */
export const extensionsPage = import.meta.env.FIREFOX ? 'about:addons' : 'chrome://extensions';
