import type { OwnerContext } from '#lib/server/auth.js';

declare global {
	namespace App {
		interface Locals {
			requestId: string;
			owner?: Promise<OwnerContext>;
		}
	}
}
export {};
