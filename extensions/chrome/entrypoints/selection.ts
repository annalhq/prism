import { readSelection } from '@prism/extension-shared/selection';

// Run in the page by the context menu's "Add to Prism"; its result goes back to the background.
export default defineUnlistedScript(readSelection);
