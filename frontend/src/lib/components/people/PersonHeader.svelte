<script lang="ts">
	import { ArrowLeft, Globe, Link2, Pencil } from '@lucide/svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- Profile links are validated external HTTP URLs. */
	import { asset } from '$app/paths';
	import { linkLabel } from '#lib/domain/person-links.js';
	import PersonAvatar from '../ui/PersonAvatar.svelte';
	type Row = Record<string, unknown>;
	let {
		person,
		website = null,
		links = [],
		count,
		onBack,
		onEdit
	}: {
		person: Row;
		website?: string | null;
		links?: Row[];
		count: number;
		onBack: () => void;
		// Absent on the public page, which shows the profile without letting anyone change it.
		onEdit?: () => void;
	} = $props();
	const name = $derived(String(person.displayName));
</script>

<header class="person-head">
	<button class="person-back" onclick={onBack}><ArrowLeft />People</button>
	<div class="person-head-main">
		<PersonAvatar {name} size={64} />
		<div class="person-head-copy">
			<h2>{name}</h2>
			{#if website || links.length}<p class="person-links">
					{#each links as link (String(link.id))}<a
							href={String(link.profileUrl)}
							target="_blank"
							rel="noopener noreferrer"
							>{#if link.platform === 'x'}<img
									src={asset('site-icons/twitter.svg')}
									alt=""
									width="12"
									height="12"
								/>{:else}<Link2 />{/if}{linkLabel({
								platform: String(link.platform),
								profileUrl: String(link.profileUrl),
								handle: link.handle ? String(link.handle) : null
							})}</a
						>{/each}{#if website}<a href={website} target="_blank" rel="noopener noreferrer"
							><Globe />{linkLabel({ platform: 'web', profileUrl: website })}</a
						>{/if}
				</p>{/if}
		</div>
		{#if onEdit}<button
				class="icon-button person-edit"
				aria-label="Edit profile"
				title="Edit profile"
				onclick={onEdit}
				data-cuelume-open><Pencil /></button
			>{/if}
	</div>
	{#if person.bio}<p class="person-bio">{person.bio}</p>{/if}
	<p class="person-stats">
		<strong>{count}</strong>
		{count === 1 ? 'link' : 'links'}
	</p>
</header>
