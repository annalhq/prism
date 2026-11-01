<script lang="ts">
	import { ArrowLeft, Globe, Link2, Pencil } from '@lucide/svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- Profile links are validated external HTTP URLs. */
	import { asset } from '$app/paths';
	import { linkLabel } from '#lib/domain/person-links.js';
	import PersonAvatar, { avatarHue } from '../ui/PersonAvatar.svelte';
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

<!-- A cover tinted with the person's own colour, the avatar resting on its edge, then who they
     are: the name, their count and links as pills, and the bio. -->
<header class="person-head" style:--person-hue={avatarHue(name)}>
	<div class="person-cover">
		<button class="landing-glass person-back" onclick={onBack}><ArrowLeft />People</button>
		{#if onEdit}<button
				class="landing-glass person-edit"
				aria-label="Edit profile"
				title="Edit profile"
				onclick={onEdit}
				data-cuelume-open><Pencil /></button
			>{/if}
	</div>
	<div class="person-identity">
		<PersonAvatar {name} size={76} />
		<h2>{name}</h2>
		<div class="person-meta">
			<span class="person-stats"><strong>{count}</strong> {count === 1 ? 'link' : 'links'}</span
			>{#each links as link (String(link.id))}<a
					class="person-link"
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
				>{/each}{#if website}<a
					class="person-link"
					href={website}
					target="_blank"
					rel="noopener noreferrer"
					><Globe />{linkLabel({ platform: 'web', profileUrl: website })}</a
				>{/if}
		</div>
		{#if person.bio}<p class="person-bio">{person.bio}</p>{/if}
	</div>
</header>
