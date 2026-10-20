import { loadLibrarySession } from '#lib/server/page-session.js';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = loadLibrarySession;
