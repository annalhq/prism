<script lang="ts">
	import {
		Clock3 as Clock3Icon,
		Copy as CopyIcon,
		Ellipsis as EllipsisIcon,
		Pencil as PencilIcon,
		Trash2 as Trash2Icon,
		Unlink as UnlinkIcon
	} from '@lucide/svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- Posts open validated external HTTP source URLs. */
	import { DropdownMenu } from 'bits-ui';
	import Favicon from './ui/Favicon.svelte';
	import PersonAvatar from './ui/PersonAvatar.svelte';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import { isReadLater, postTime, type Row } from '#lib/client/workflows.js';
	export type PostAuthor = {
		id: string;
		name: string;
		handle: string | null;
		avatarConfig: unknown;
		labels: string[];
	};
	let {
		item,
		authors,
		note = '',
		tagLabels = [],
		selected = false,
		onEdit,
		onAction,
		onOpen,
		onPerson,
		onDisconnect,
		feedback = () => {}
	}: {
		item: Row;
		// The first author is the one the post is shown "from"; the rest are tagged along.
		authors: PostAuthor[];
		note?: string;
		tagLabels?: string[];
		selected?: boolean;
		onEdit: () => void;
		onAction: (action: 'later' | 'trash') => void;
		onOpen: () => void;
		onPerson: (id: string) => void;
		onDisconnect?: () => void;
		feedback?: (message: string) => void;
	} = $props();
	const author = $derived(authors[0]);
	const others = $derived(authors.slice(1));
	const source = $derived.by(() => {
		try {
			return normalizeUrl(String(item.url)).url;
		} catch {
			return null;
		}
	});
	const domain = $derived(
		String(item.domain ?? (source ? new URL(source).hostname : '')).replace(/^www\./, '')
	);
	const created = $derived(new Date(String(item.createdAt)));
	function openSource() {
		if (!source) return onEdit();
		onOpen();
		window.open(source, '_blank', 'noopener,noreferrer');
	}
	async function copy() {
		if (!source) return;
		try {
			await navigator.clipboard.writeText(source);
			feedback('Link copied.');
		} catch {
			feedback('Could not copy. Open the bookmark and copy its address.');
		}
	}
</script>

<article
	class="post bookmark-gesture"
	class:selected
	data-bookmark-id={String(item.id)}
	aria-label={`${author?.name ?? 'Someone'}: ${item.title}`}
>
	{#if author}<button
			class="post-avatar"
			aria-label={`Open ${author.name}`}
			tabindex="-1"
			onclick={() => onPerson(author.id)}
			><PersonAvatar
				id={author.id}
				config={author.avatarConfig}
				handle={author.handle}
				size={40}
			/></button
		>{/if}
	<div class="post-body">
		<header class="post-header">
			{#if author}<button class="post-author" tabindex="-1" onclick={() => onPerson(author.id)}
					>{author.name}</button
				>{#if author.handle}<span class="post-handle">@{author.handle}</span>{/if}<span
					class="post-dot"
					aria-hidden="true">·</span
				>{/if}<time
				class="post-time"
				datetime={created.toISOString()}
				title={created.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}
				>{postTime(item.createdAt)}</time
			>
			{#if author?.labels.length}<span class="post-relation">{author.labels.join(' · ')}</span>{/if}
			{#if isReadLater(item)}<span class="later-badge" title="Read later"
					><Clock3Icon /><span class="sr-only">Read later</span></span
				>{/if}
			<DropdownMenu.Root
				><DropdownMenu.Trigger class="icon-button post-menu" aria-label="Post actions"
					><EllipsisIcon /></DropdownMenu.Trigger
				><DropdownMenu.Portal
					><DropdownMenu.Content class="menu-content" align="end" sideOffset={4}
						><DropdownMenu.Item class="menu-item" onSelect={onEdit}
							><PencilIcon />Edit</DropdownMenu.Item
						>{#if source}<DropdownMenu.Item class="menu-item" onSelect={copy}
								><CopyIcon />Copy link</DropdownMenu.Item
							>{/if}<DropdownMenu.Item class="menu-item" onSelect={() => onAction('later')}
							><Clock3Icon />{isReadLater(item)
								? 'Remove from Read later'
								: 'Read later'}</DropdownMenu.Item
						>{#if onDisconnect}<DropdownMenu.Item class="menu-item" onSelect={onDisconnect}
								><UnlinkIcon />Disconnect from {author?.name ?? 'this person'}</DropdownMenu.Item
							>{/if}<DropdownMenu.Separator class="menu-separator" /><DropdownMenu.Item
							class="menu-item danger-text"
							onSelect={() => onAction('trash')}><Trash2Icon />Delete</DropdownMenu.Item
						></DropdownMenu.Content
					></DropdownMenu.Portal
				></DropdownMenu.Root
			>
		</header>
		{#if others.length}<p class="post-with">
				with {#each others as other, index (other.id)}{index ? ', ' : ''}<button
						tabindex="-1"
						onclick={() => onPerson(other.id)}
						>{other.handle ? `@${other.handle}` : other.name}</button
					>{/each}
			</p>{/if}
		{#if note}<p class="post-text">{note}</p>{/if}
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
			><span class="post-link-icon"><Favicon url={source} /></span><span class="post-link-copy"
				><strong>{item.title}</strong>{#if domain}<small>{domain}</small>{/if}</span
			></a
		>
		{#if tagLabels.length}<div class="post-tags">
				{#each tagLabels as label (label)}<span class="post-tag">#{label}</span>{/each}
			</div>{/if}
	</div>
	<button
		hidden
		class="bookmark-open"
		tabindex="-1"
		aria-label={`Open ${item.title}`}
		onclick={openSource}
	></button>
	<button
		hidden
		class="bookmark-edit"
		tabindex="-1"
		aria-label={`Edit ${item.title}`}
		onclick={onEdit}
	></button>
	{#if source}<button
			hidden
			class="bookmark-copy"
			tabindex="-1"
			aria-label={`Copy link for ${item.title}`}
			onclick={copy}
		></button>{/if}
</article>
