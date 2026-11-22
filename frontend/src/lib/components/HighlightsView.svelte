<script lang="ts">
	import {
		ArrowUpRight as ArrowUpRightIcon,
		Copy as CopyIcon,
		Pencil as PencilIcon,
		Quote as QuoteIcon
	} from '@lucide/svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- Passages open validated external HTTP source URLs. */
	import { SvelteSet } from 'svelte/reactivity';
	import Favicon from './ui/Favicon.svelte';
	import { renderNotePreview } from '#lib/domain/notes.js';
	import { bookmarkDomain, bookmarkSource, copyLink, type Row } from '#lib/client/workflows.js';
	import {
		paragraphs,
		passagesMarkdown,
		passageUrl,
		type Passage
	} from '#lib/client/highlights.svelte.js';

	let {
		items,
		passagesOf,
		noteOf,
		selectedId = null,
		marked,
		onEdit,
		onOpen,
		feedback
	}: {
		items: Row[];
		passagesOf: (item: Row) => Passage[];
		// The reader's own note on the page, if any (not the appended passages).
		noteOf: (item: Row) => string;
		selectedId?: string | null;
		marked: Set<string>;
		onEdit: (item: Row) => void;
		onOpen: (item: Row) => void;
		feedback: (message: string) => void;
	} = $props();

	// A page with many passages shows its first few until asked for the rest.
	const FOLDED = 3;
	const unfolded = new SvelteSet<string>();

	const entries = $derived(
		items.map((item) => {
			const source = bookmarkSource(item);
			// A passage's text never changes, so a paragraph's place in it is a stable key.
			const passages = passagesOf(item).map((passage) => ({
				...passage,
				parts: paragraphs(passage.text).map((text, n) => ({ key: `${passage.id}:${n}`, text }))
			}));
			return { item, id: String(item.id), source, passages };
		})
	);
	const total = $derived(entries.reduce((sum, entry) => sum + entry.passages.length, 0));

	const day = (value: unknown) =>
		value
			? new Date(String(value)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
			: '';

	function open(item: Row, source: string | null, href = source) {
		if (!href) {
			onEdit(item);
			return;
		}
		onOpen(item);
		window.open(href, '_blank', 'noopener,noreferrer');
	}
	async function copyText(text: string, message: string) {
		try {
			await navigator.clipboard.writeText(text);
			feedback(message);
		} catch {
			feedback('Could not copy.');
		}
	}
</script>

{#if entries.length}<p class="reading-summary">
		<QuoteIcon aria-hidden="true" />
		<span
			>{total}
			{total === 1 ? 'passage' : 'passages'} from {entries.length}
			{entries.length === 1 ? 'page' : 'pages'}</span
		>
	</p>{/if}

{#each entries as { item, id, source, passages } (id)}
	{@const folded = passages.length > FOLDED + 1 && !unfolded.has(id)}
	{@const shown = folded ? passages.slice(0, FOLDED) : passages}
	{@const note = noteOf(item).trim()}
	<article
		class={[
			'bookmark-gesture reading-card',
			selectedId === id && 'selected',
			marked.has(id) && 'marked'
		]}
		data-bookmark-id={id}
		aria-labelledby={`reading-${id}`}
	>
		<header class="reading-source">
			<Favicon url={source} />
			<span class="reading-site">{bookmarkDomain(item, source)}</span>
			<span class="reading-meta"
				>{passages.length}
				{passages.length === 1 ? 'highlight' : 'highlights'} ·
				<time datetime={String(item.createdAt)}>{day(item.createdAt)}</time></span
			>
			<span class="reading-actions">
				<button
					class="icon-button"
					title="Copy highlights as Markdown"
					aria-label={`Copy highlights from ${item.title}`}
					onclick={() =>
						void copyText(
							passagesMarkdown(String(item.title), source, passages),
							'Highlights copied.'
						)}><CopyIcon /></button
				><button
					class="icon-button"
					title="Edit"
					aria-label={`Edit ${item.title}`}
					onclick={() => onEdit(item)}><PencilIcon /></button
				>
			</span>
		</header>
		{#if source}<a
				id={`reading-${id}`}
				class="bookmark-title reading-title"
				href={source}
				target="_blank"
				rel="noopener noreferrer"
				onclick={() => onOpen(item)}>{item.title}</a
			>{:else}<button
				id={`reading-${id}`}
				class="bookmark-title reading-title"
				onclick={() => onEdit(item)}>{item.title}</button
			>{/if}

		<ol class="passages">
			{#each shown as passage, index (passage.id)}
				<li class="passage">
					<span class="passage-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span
					>
					<blockquote class="passage-text">
						{#each passage.parts as part (part.key)}<p><mark>{part.text}</mark></p>{/each}
					</blockquote>
					<span class="passage-tools">
						{#if passage.createdAt}<time datetime={passage.createdAt}>{day(passage.createdAt)}</time
							>{/if}
						{#if source}<a
								href={passageUrl(source, passage.text)}
								target="_blank"
								rel="noopener noreferrer"
								title="Open the page at this passage"
								onclick={() => onOpen(item)}>In context<ArrowUpRightIcon /></a
							>{/if}
						<button
							title="Copy passage"
							onclick={() => void copyText(passage.text, 'Passage copied.')}>Copy</button
						>
					</span>
				</li>
			{/each}
		</ol>
		{#if folded}<button class="passages-more" onclick={() => unfolded.add(id)}
				>{passages.length - FOLDED} more {passages.length - FOLDED === 1
					? 'highlight'
					: 'highlights'}</button
			>{/if}
		{#if note}<div class="reading-note note-prose">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- Sanitised by the note renderer. -->
				{@html renderNotePreview(note)}
			</div>{/if}

		<!-- The list's keyboard shortcuts (o, e, y) find these in each row. -->
		<button
			hidden
			class="bookmark-open"
			tabindex="-1"
			aria-label={`Open ${item.title}`}
			onclick={() => open(item, source)}
		></button>
		<button
			hidden
			class="bookmark-edit"
			tabindex="-1"
			aria-label={`Edit ${item.title}`}
			onclick={() => onEdit(item)}
		></button>
		{#if source}<button
				hidden
				class="bookmark-copy"
				tabindex="-1"
				aria-label={`Copy link for ${item.title}`}
				onclick={() => void copyLink(source, feedback)}
			></button>{/if}
	</article>
{/each}
