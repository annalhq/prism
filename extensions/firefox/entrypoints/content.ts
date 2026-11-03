import { contentMatches, startContent } from '@prism/extension-shared/content';

export default defineContentScript({
	matches: contentMatches,
	runAt: 'document_idle',
	main: startContent
});
