// Writes static/themes/theme.schema.json from the token registry. Run after adding tokens.
import { writeFile } from 'node:fs/promises';
import {
	COLOR_TOKENS,
	FONT_KEYS,
	PALETTE_KEYS,
	RADIUS_KEYS,
	RADIUS_RANGE,
	SCALE_RANGE
} from '../../src/lib/domain/theme.js';

const color = {
	type: 'string',
	maxLength: 96,
	pattern:
		'^(#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\\([0-9\\s,/%.+deEgnorturad-]*\\)|transparent)$'
};
const colors = (keys: readonly string[]) => ({
	type: 'object',
	additionalProperties: false,
	properties: Object.fromEntries(keys.map((key) => [key, color]))
});
const font = {
	type: 'string',
	maxLength: 200,
	description: 'Up to 4 installed font family names, comma separated.'
};
const schema = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	title: 'Prism theme or module',
	type: 'object',
	additionalProperties: false,
	required: ['prism', 'name'],
	properties: {
		$schema: { type: 'string' },
		prism: { const: 1 },
		kind: { enum: ['theme', 'module'], default: 'theme' },
		name: { type: 'string', minLength: 1, maxLength: 64 },
		author: { type: 'string', maxLength: 120 },
		description: { type: 'string', maxLength: 160 },
		scheme: {
			enum: ['dark', 'light'],
			description: 'Required for themes; not allowed on modules.'
		},
		palette: { ...colors(PALETTE_KEYS), required: ['background', 'foreground'] },
		colors: colors(COLOR_TOKENS),
		shape: {
			type: 'object',
			additionalProperties: false,
			properties: {
				radius: {
					type: 'object',
					additionalProperties: false,
					properties: Object.fromEntries(
						RADIUS_KEYS.map((key) => [
							key,
							{ type: 'number', minimum: RADIUS_RANGE[0], maximum: RADIUS_RANGE[1] }
						])
					)
				}
			}
		},
		typography: {
			type: 'object',
			additionalProperties: false,
			properties: {
				...Object.fromEntries(FONT_KEYS.map((key) => [key, font])),
				scale: { type: 'number', minimum: SCALE_RANGE[0], maximum: SCALE_RANGE[1] }
			}
		}
	},
	if: { properties: { kind: { const: 'module' } }, required: ['kind'] },
	then: { not: { required: ['scheme'] } },
	else: { required: ['scheme'] }
};

await writeFile('static/themes/theme.schema.json', `${JSON.stringify(schema, null, '\t')}\n`);
