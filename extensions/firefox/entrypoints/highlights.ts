import { startHighlights } from '@prism/extension-shared/highlights';

// Registered at runtime by the background when "Show highlights on pages" is on.
export default defineUnlistedScript(startHighlights);
