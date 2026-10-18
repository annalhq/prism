import { keys, object, ValidationError } from './validation-fields.js';

// Notion Avatar parts (MIT); pinned locally so saved configurations remain stable.
export const AVATAR_PARTS = {
	face: 16,
	nose: 14,
	mouth: 20,
	eyes: 14,
	eyebrows: 16,
	glasses: 15,
	hair: 59,
	accessories: 15,
	details: 14,
	beard: 17
} as const;
export type AvatarPart = keyof typeof AVATAR_PARTS;
export type AvatarConfig = { version: 1; parts: Record<AvatarPart, number> };
export const AVATAR_LAYERS: AvatarPart[] = [
	'face',
	'details',
	'mouth',
	'nose',
	'eyes',
	'eyebrows',
	'beard',
	'hair',
	'accessories',
	'glasses'
];
export function parseAvatar(value: unknown): AvatarConfig | null {
	if (value == null) return null;
	const config = object(value);
	keys(config, ['version', 'parts']);
	if (config.version !== 1) throw new ValidationError('Unsupported avatar version.');
	const parts = object(config.parts);
	keys(parts, Object.keys(AVATAR_PARTS));
	for (const [key, count] of Object.entries(AVATAR_PARTS)) {
		if (!Number.isInteger(parts[key]) || Number(parts[key]) < 0 || Number(parts[key]) >= count)
			throw new ValidationError('Invalid avatar part.');
	}
	return { version: 1, parts: parts as AvatarConfig['parts'] };
}
export function avatarFromSeed(seed: string): AvatarConfig {
	let state = 2166136261;
	for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
	const random = () => {
		state = (Math.imul(state, 1664525) + 1013904223) | 0;
		return (state >>> 0) / 4294967296;
	};
	const parts = {} as AvatarConfig['parts'];
	for (const [key, count] of Object.entries(AVATAR_PARTS)) {
		parts[key as AvatarPart] =
			['beard', 'accessories', 'details'].includes(key) || (key === 'glasses' && random() > 0.4)
				? 0
				: Math.floor(random() * count);
	}
	return { version: 1, parts };
}
