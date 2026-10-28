<script lang="ts">
	import {
		ArrowUpRight as ArrowUpRightIcon,
		Clock3 as Clock3Icon,
		Copy as CopyIcon,
		Ellipsis as EllipsisIcon,
		Pencil as PencilIcon,
		Trash2 as Trash2Icon,
		Unlink as UnlinkIcon
	} from '@lucide/svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- Posts open validated external HTTP source URLs. */
	import { DropdownMenu } from 'bits-ui';
	import PersonAvatar from './ui/PersonAvatar.svelte';
	import TweetCard from './TweetCard.svelte';
	import { tweetStatusId } from '#lib/domain/tweets.js';
	import {
		bookmarkDomain,
		bookmarkSource,
		copyLink,
		isReadLater,
		type Row
	} from '#lib/client/workflows.js';
	export type PostPerson = { id: string; name: string; handle: string | null };
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
	function openSource() {
		if (!source) return onEdit();
		onOpen();
		window.open(source, '_blank', 'noopener,noreferrer');
	}
	function copy() {
		if (source) void copyLink(source, feedback);
	}
</script>

<article
	class="post bookmark-gesture"
	class:selected
	data-bookmark-id={String(item.id)}
	aria-label={lead ? `${lead.name}: ${item.title}` : String(item.title)}
>
	{#if lead || !readonly}<header class="post-header">
			{#if lead}<button
					class="post-person"
					tabindex="-1"
					onclick={() => onPerson(lead.id)}
					aria-label={`Open ${lead.name}`}
					><PersonAvatar name={lead.name} size={24} /><span>{lead.name}</span></button
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
			{#if !readonly}<DropdownMenu.Root
					><DropdownMenu.Trigger class="icon-button post-menu" aria-label="Post actions"
						><EllipsisIcon /></DropdownMenu.Trigger
					><DropdownMenu.Portal
						><DropdownMenu.Content class="menu-content" align="end" sideOffset={6}
							>{#if source}<DropdownMenu.Item class="menu-item" onSelect={openSource}
									><ArrowUpRightIcon /><span>Open link</span><kbd>o</kbd></DropdownMenu.Item
								>{/if}<DropdownMenu.Item class="menu-item" onSelect={onEdit}
								><PencilIcon /><span>Edit</span><kbd>e</kbd></DropdownMenu.Item
							>{#if source}<DropdownMenu.Item class="menu-item" onSelect={copy}
									><CopyIcon /><span>Copy link</span><kbd>y</kbd></DropdownMenu.Item
								>{/if}<DropdownMenu.Item class="menu-item" onSelect={() => onAction('later')}
								><Clock3Icon /><span
									>{isReadLater(item) ? 'Remove from Read later' : 'Read later'}</span
								></DropdownMenu.Item
							>{#if onDisconnect}<DropdownMenu.Item class="menu-item" onSelect={onDisconnect}
									><UnlinkIcon /><span>Disconnect</span></DropdownMenu.Item
								>{/if}<DropdownMenu.Separator class="menu-separator" /><DropdownMenu.Item
								class="menu-item danger-text"
								onSelect={() => onAction('trash')}
								><Trash2Icon /><span>Move to trash</span></DropdownMenu.Item
							></DropdownMenu.Content
						></DropdownMenu.Portal
					></DropdownMenu.Root
				>{/if}
		</header>{/if}
	{#if note}<p class="post-text">{note}</p>{/if}
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
