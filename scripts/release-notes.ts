#!/usr/bin/env bun
/**
 * Writes GitHub release notes (Markdown) from the Conventional Commits between two refs.
 *
 *   bun scripts/release-notes.ts [--from <ref>] [--to <ref>]
 *
 * `--from` defaults to the latest tag before `--to` (the whole history if there is none);
 * `--to` defaults to HEAD. Both `feat(scope)!:` and `feat!(scope):` mark a breaking change, as does
 * a `BREAKING CHANGE:` footer. Prints nothing when no commits are in range.
 */
import { $ } from 'bun';

type Commit = { hash: string; subject: string; body: string };
type Entry = { scope?: string; description: string; hash: string; breaking?: string };

const sections: { types: string[]; title: string }[] = [
	{ types: ['feat'], title: 'Features' },
	{ types: ['fix'], title: 'Bug fixes' },
	{ types: ['perf'], title: 'Performance' },
	{ types: ['refactor'], title: 'Refactoring' },
	{ types: ['style'], title: 'Styling' },
	{ types: ['docs'], title: 'Documentation' }
];
/** Kept out of the main list; shown in a collapsed block so the page stays readable. */
const maintenance = ['chore', 'build', 'ci', 'test', 'revert'];

const header = /^(\w+)(?:\(([^)]*)\))?(!)?(?:\(([^)]*)\))?(!)?:\s+(.+)$/;

function argument(name: string): string | undefined {
	const index = Bun.argv.indexOf(`--${name}`);
	const value = index === -1 ? undefined : Bun.argv[index + 1];
	return value && !value.startsWith('--') ? value : undefined;
}

async function previousTag(ref: string): Promise<string | undefined> {
	const result = await $`git describe --tags --abbrev=0 ${ref}^`.quiet().nothrow();
	return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
}

async function repositoryUrl(): Promise<string> {
	if (process.env.GITHUB_REPOSITORY)
		return `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}`;
	const remote = (await $`git remote get-url origin`.quiet().text()).trim();
	return remote.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
}

async function commits(range: string): Promise<Commit[]> {
	const log = await $`git log --no-merges --format=%H%x1f%s%x1f%b%x1e ${range}`.quiet().text();
	return log
		.split('\x1e')
		.map((record) => record.trim())
		.filter(Boolean)
		.map((record) => {
			const [hash, subject, body = ''] = record.split('\x1f');
			return { hash, subject: subject.trim(), body: body.trim() };
		});
}

const to = argument('to') ?? 'HEAD';
const from = argument('from') ?? (await previousTag(to));
const repo = await repositoryUrl();
const list = await commits(from ? `${from}..${to}` : to);

const grouped = new Map<string, Entry[]>();
const breaking: Entry[] = [];
const other: Entry[] = [];

for (const commit of list) {
	// Release commits only bump versions and the changelog.
	if (/^chore\(release\)/.test(commit.subject)) continue;
	const match = header.exec(commit.subject);
	const footer = /^BREAKING[ -]CHANGE:\s*([\s\S]+?)(?:\n\n|$)/m.exec(commit.body)?.[1]?.trim();
	if (!match) {
		other.push({ description: commit.subject, hash: commit.hash });
		continue;
	}
	const [, type, scopeA, bangA, scopeB, bangB, description] = match;
	const entry: Entry = {
		scope: (scopeA ?? scopeB)?.trim() || undefined,
		description: description.trim(),
		hash: commit.hash
	};
	if (bangA || bangB || footer) breaking.push({ ...entry, breaking: footer ?? entry.description });
	const kind = type.toLowerCase();
	if (sections.some((section) => section.types.includes(kind))) {
		grouped.set(kind, [...(grouped.get(kind) ?? []), entry]);
	} else if (maintenance.includes(kind)) other.push(entry);
	else other.push({ ...entry, description: commit.subject, scope: undefined });
}

function line(entry: Entry, text = entry.description): string {
	const scope = entry.scope ? `**${entry.scope}:** ` : '';
	return `- ${scope}${text} ([\`${entry.hash.slice(0, 7)}\`](${repo}/commit/${entry.hash}))`;
}

/** Scoped entries grouped together, alphabetically; unscoped ones first. */
function sorted(entries: Entry[]): Entry[] {
	return [...entries].sort((a, b) => (a.scope ?? '').localeCompare(b.scope ?? ''));
}

const out: string[] = [];
if (breaking.length) {
	out.push('## ⚠️ Breaking changes', '', ...sorted(breaking).map((entry) => line(entry, entry.breaking)), '');
}
for (const section of sections) {
	const entries = section.types.flatMap((type) => grouped.get(type) ?? []);
	if (entries.length) out.push(`## ${section.title}`, '', ...sorted(entries).map((entry) => line(entry)), '');
}
if (other.length) {
	out.push(
		'<details>',
		`<summary>Maintenance (${other.length})</summary>`,
		'',
		...sorted(other).map((entry) => line(entry)),
		'',
		'</details>',
		''
	);
}
if (out.length) {
	const target = to === 'HEAD' ? 'main' : to;
	out.push(
		from
			? `**Full changelog:** [\`${from}...${target}\`](${repo}/compare/${from}...${target})`
			: `**Full changelog:** [commits](${repo}/commits/${target})`
	);
	console.log(out.join('\n'));
}
