import type { OwnerContext } from '#lib/server/auth.js';
import type { RequestTimings } from '#lib/server/timing.js';

declare global {
	namespace App {
		interface Locals {
			requestId: string;
			owner?: Promise<OwnerContext>;
			timings?: RequestTimings;
		}
	}
}
export {};
