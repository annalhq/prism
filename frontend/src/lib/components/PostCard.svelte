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
	export type PostPerson = { id: string; name: string; handle: string | null };
	let {
		item,
		people = [],
		note = '',
		tagLabels = [],
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
		tagLabels?: string[];
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
	class:with-people={!!lead}
	data-bookmark-id={String(item.id)}
	aria-label={lead ? `${lead.name}: ${item.title}` : String(item.title)}
>
	<div class="post-gutter">
		{#if lead}<button
				class="post-avatar"
				aria-label={`Open ${lead.name}`}
				tabindex="-1"
				onclick={() => onPerson(lead.id)}
				><PersonAvatar name={lead.name} handle={lead.handle} size={32} /></button
			>{:else}<span class="post-site"><Favicon url={source} /></span>{/if}
	</div>
	<div class="post-body">
		<header class="post-header">
			{#if lead}<span class="post-people"
					>{#each people.slice(0, 2) as person, index (person.id)}{index ? ', ' : ''}<button
							tabindex="-1"
							onclick={() => onPerson(person.id)}>{person.name}</button
						>{/each}{#if people.length > 2}<span class="post-more">
							+{people.length - 2}</span
						>{/if}</span
				>{:else if domain}<span class="post-domain">{domain}</span>{/if}<time
				class="post-time"
				datetime={created.toISOString()}
				title={created.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}
				>{postTime(item.createdAt)}</time
			>
			{#if isReadLater(item)}<span class="later-badge" title="Read later"
					><Clock3Icon /><span class="sr-only">Read later</span></span
				>{/if}
			{#if !readonly}<DropdownMenu.Root
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
									><UnlinkIcon />Disconnect</DropdownMenu.Item
								>{/if}<DropdownMenu.Separator class="menu-separator" /><DropdownMenu.Item
								class="menu-item danger-text"
								onSelect={() => onAction('trash')}><Trash2Icon />Delete</DropdownMenu.Item
							></DropdownMenu.Content
						></DropdownMenu.Portal
					></DropdownMenu.Root
				>{/if}
		</header>
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
			>{#if lead}<Favicon url={source} />{/if}<span>{item.title}</span>{#if lead && domain}<small
					>{domain}</small
				>{/if}</a
		>
		{#if note}<p class="post-text">{note}</p>{/if}
		{#if tagLabels.length}<p class="post-tags">
				{#each tagLabels as label (label)}<span>#{label}</span>{/each}
			</p>{/if}
	</div>
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
