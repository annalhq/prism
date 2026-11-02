<script lang="ts" module>
	// One post menu open at a time: bits-ui does not treat a right-click on another trigger as
	// an outside interaction, so the previous menu would stay open.
	let closeOpenMenu: (() => void) | null = null;
</script>

<script lang="ts">
	import {
		ArrowUpRight as ArrowUpRightIcon,
		Clock3 as Clock3Icon,
		Copy as CopyIcon,
		Pencil as PencilIcon,
		Trash2 as Trash2Icon,
		Unlink as UnlinkIcon
	} from '@lucide/svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- Posts open validated external HTTP source URLs. */
	import { ContextMenu } from 'bits-ui';
	import Favicon from './ui/Favicon.svelte';
	import PersonAvatar from './ui/PersonAvatar.svelte';
	import { renderMarkdown } from '#lib/client/markdown.js';
	import { renderNote } from '#lib/domain/notes.js';
	import TweetCard from './TweetCard.svelte';
	import { tweetStatusId } from '#lib/domain/tweets.js';
	import {
		bookmarkDomain,
		bookmarkSource,
		copyLink,
		isReadLater,
		type Row
	} from '#lib/client/workflows.js';
	export type PostPerson = {
		id: string;
		name: string;
		handle: string | null;
		// Their profile photo URL, when one of their links can give one.
		photo?: string | null;
	};
	let {
		item,
		people = [],
		note = '',
		selected = false,
		readonly = false,
		onEdit,
		onAction,
		onOpen,
		onPerson,
		onDisconnect,
		feedback = () => {}
	}: {
		item: Row;
		// The people this link is connected to. Empty on a profile, where the person is the page.
		people?: PostPerson[];
		note?: string;
		selected?: boolean;
		readonly?: boolean;
		onEdit: () => void;
		onAction: (action: 'later' | 'trash') => void;
		onOpen: () => void;
		onPerson: (id: string) => void;
		onDisconnect?: () => void;
		feedback?: (message: string) => void;
	} = $props();
	const lead = $derived(people[0]);
	const source = $derived(bookmarkSource(item));
	// Posts from X render as the post itself. The public page can't reach the owner-only
	// tweet API, so it keeps the plain link card.
	const tweetId = $derived(readonly ? null : tweetStatusId(source));
	const domain = $derived(bookmarkDomain(item, source));
	// The note as rendered Markdown: local first, Sätteri when it arrives (owner only).
	let noteHtml = $state('');
	$effect(() => {
		if (!note) return;
		const markdown = note;
		noteHtml = renderNote(markdown);
		if (readonly) return;
		let live = true;
		void renderMarkdown(markdown).then((html) => {
			if (live) noteHtml = html;
		});
		return () => {
			live = false;
		};
	});
	function openSource() {
		if (!source) return onEdit();
		onOpen();
		window.open(source, '_blank', 'noopener,noreferrer');
	}
	function copy() {
		if (source) void copyLink(source, feedback);
	}
	let menuOpen = $state(false);
	$effect(() => {
		if (!menuOpen) return;
		const close = () => (menuOpen = false);
		if (closeOpenMenu !== close) closeOpenMenu?.();
		closeOpenMenu = close;
		// A fixed-position menu left behind by scrolling no longer points at its post.
		const scroll = (event: Event) => {
			if (!(event.target as HTMLElement | null)?.closest?.('.menu-content')) close();
		};
		window.addEventListener('scroll', scroll, true);
		window.addEventListener('blur', close);
		return () => {
			window.removeEventListener('scroll', scroll, true);
			window.removeEventListener('blur', close);
			if (closeOpenMenu === close) closeOpenMenu = null;
		};
	});
</script>

{#snippet post(props: Record<string, unknown> = {})}
	<article
		{...props}
		class={['post', 'bookmark-gesture', selected && 'selected']}
		data-bookmark-id={String(item.id)}
		aria-label={lead ? `${lead.name}: ${item.title}` : String(item.title)}
	>
		{#if lead || isReadLater(item)}<header class="post-header">
				{#if lead}<button
						class="post-person"
						tabindex="-1"
						onclick={() => onPerson(lead.id)}
						aria-label={`Open ${lead.name}`}
						><PersonAvatar
							name={lead.name}
							photo={readonly ? null : (lead.photo ?? null)}
							size={24}
						/><span>{lead.name}</span></button
					>{#if people.length > 1}<span class="post-more"
							>and {#each people.slice(1, 3) as person, index (person.id)}{index ? ', ' : ''}<button
									tabindex="-1"
									onclick={() => onPerson(person.id)}>{person.name}</button
								>{/each}{#if people.length > 3}
								+{people.length - 3}{/if}</span
						>{/if}{/if}
				{#if isReadLater(item)}<span class="later-badge" title="Read later"
						><Clock3Icon /><span class="sr-only">Read later</span></span
					>{/if}
			</header>{/if}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- Sanitised by the note renderers. -->
		{#if note}<div class="post-text note-prose">{@html noteHtml}</div>{/if}
		<!-- The link itself, nested like a quoted card: just what it is and where it lives. -->
		{#snippet linkCard()}
			<a
				class="post-link bookmark-title"
				href={source ?? undefined}
				target="_blank"
				rel="noopener noreferrer"
				onclick={(event) => {
					if (!source) {
						event.preventDefault();
						onEdit();
					} else onOpen();
				}}
				><span class="post-link-title">{item.title}</span>{#if domain}<span class="post-link-site"
						>{domain}</span
					>{/if}</a
			>
		{/snippet}
		{#if tweetId}<TweetCard
				id={tweetId}
				{onOpen}
				fallback={linkCard}
				shown={people.slice(0, 3)}
			/>{:else}{@render linkCard()}{/if}
		<button
			hidden
			class="bookmark-open"
			tabindex="-1"
			aria-label={`Open ${item.title}`}
			onclick={openSource}
		></button>
		{#if !readonly}<button
				hidden
				class="bookmark-edit"
				tabindex="-1"
				aria-label={`Edit ${item.title}`}
				onclick={onEdit}
			></button>{/if}
		{#if source}<button
				hidden
				class="bookmark-copy"
				tabindex="-1"
				aria-label={`Copy link for ${item.title}`}
				onclick={copy}
			></button>{/if}
	</article>
{/snippet}

<!-- Actions live in a right-click (long-press on touch) menu, like bookmark rows. -->
{#if readonly}{@render post()}{:else}<ContextMenu.Root bind:open={menuOpen}
		><ContextMenu.Trigger
			>{#snippet child({ props })}{@render post(props)}{/snippet}</ContextMenu.Trigger
		><ContextMenu.Portal
			><ContextMenu.Content class="menu-content">
				<div class="menu-header" aria-hidden="true">
					<Favicon url={source} /><span>{domain || item.title}</span>
				</div>
				{#if source}<ContextMenu.Item class="menu-item" onSelect={openSource}
						><ArrowUpRightIcon /><span>Open link</span><kbd>o</kbd></ContextMenu.Item
					>{/if}<ContextMenu.Item class="menu-item" onSelect={onEdit}
					><PencilIcon /><span>Edit</span><kbd>e</kbd></ContextMenu.Item
				>{#if source}<ContextMenu.Item class="menu-item" onSelect={copy}
						><CopyIcon /><span>Copy link</span><kbd>y</kbd></ContextMenu.Item
					>{/if}<ContextMenu.Item class="menu-item" onSelect={() => onAction('later')}
					><Clock3Icon /><span>{isReadLater(item) ? 'Remove from Read later' : 'Read later'}</span
					></ContextMenu.Item
				>{#if onDisconnect}<ContextMenu.Item class="menu-item" onSelect={onDisconnect}
						><UnlinkIcon /><span>Disconnect</span></ContextMenu.Item
					>{/if}<ContextMenu.Separator class="menu-separator" /><ContextMenu.Item
					class="menu-item danger-text"
					onSelect={() => onAction('trash')}
					><Trash2Icon /><span>Move to trash</span></ContextMenu.Item
				></ContextMenu.Content
			></ContextMenu.Portal
		></ContextMenu.Root
	>{/if}
