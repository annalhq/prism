<script lang="ts">
	import { sortByPosition } from '#lib/domain/organization.js';
	import { ChevronDown as ChevronDownIcon } from '@lucide/svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- Source links use validated external HTTP URLs. App navigation uses resolve. */
	import { onMount, tick } from 'svelte';
	import { SvelteURL } from 'svelte/reactivity';
	import { DropdownMenu } from 'bits-ui';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { libraryKeyboard } from '#lib/client/keyboard-navigation.js';
	import { createPeopleFeedIndex } from '#lib/client/people-feed.js';
	import { notePreview } from '#lib/client/reference-edits.js';
	import { createSearchClient } from '#lib/client/search-client.js';
	import { emptySearch, type searchLibrary } from '#lib/client/search.js';
	import { isReadLater } from '#lib/client/workflows.js';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import { snapshotLibrary, type PublicSnapshot } from '#lib/domain/public-view.js';
	import BookmarkCard from './BookmarkCard.svelte';
	import LibrarySidebar from './LibrarySidebar.svelte';
	import MobileNavbar from './MobileNavbar.svelte';
	import Omnibar from './Omnibar.svelte';
	import TagsExplorer from './TagsExplorer.svelte';
	import PersonAvatar from './ui/PersonAvatar.svelte';

	// The owner's library, read-only: the same views, search and tags, with nothing to change.
	let { snapshot }: { snapshot: PublicSnapshot } = $props();
	type Row = Record<string, unknown>;
	const library = $derived(snapshotLibrary(snapshot));

	let sort = $state('newest'),
		limit = $state(100),
		feedFilter = $state('all'),
		sidebarCollapsed = $state(false),
		mobile = $state(false),
		navSearching = $state(false);
	let results = $state<ReturnType<typeof searchLibrary>>({ items: [], filter: emptySearch() });
	let omnibar: Omnibar | undefined = $state();
	let sidebar: LibrarySidebar | undefined = $state();
	let tagsExplorer: TagsExplorer | undefined = $state();
	let searcher = $state.raw<ReturnType<typeof createSearchClient>>();
	let generation = 0;
	const tags = $derived(sortByPosition(library.list<Row>('tags')));
	const people = $derived(library.list<Row>('people'));
	const requestedView = $derived(page.url.searchParams.get('view') ?? 'all');
	const view = $derived(
		['all', 'later', 'people', 'tags'].includes(requestedView) ||
			/^(tag|person):[\w-]+$/.test(requestedView)
			? requestedView
			: 'all'
	);
	const personId = $derived(view.startsWith('person:') ? view.slice(7) : null);
	const person = $derived(personId ? library.get<Row>('people', personId) : undefined);
	const personWebsite = $derived.by(() => {
		try {
			return normalizeUrl(String(person?.website)).url;
		} catch {
			return null;
		}
	});
	const profileLinks = $derived(createPeopleFeedIndex()(library));
	const noteBodies = $derived(
		new Map(library.list<Row>('notes').map((n) => [String(n.entityId), String(n.bodyMarkdown)]))
	);
	const title = $derived(
		person
			? String(person.displayName)
			: ((
					{
						all: 'All bookmarks',
						later: 'Read later',
						people: 'People',
						tags: 'Tags'
					} as Record<string, string>
				)[view] ??
					(view.startsWith('tag:')
						? String(library.get<Row>('tags', view.slice(4))?.name ?? 'Tag')
						: 'Library'))
	);
	let query = $derived(page.url.searchParams.get('q') ?? '');
	$effect(() => {
		const search = searcher;
		if (!search || view === 'tags') return;
		const n = ++generation;
		const entries = profileLinks.get(personId ?? '');
		const connected = new Set(
			[...(entries ?? [])]
				.filter(
					([, labels]) =>
						feedFilter === 'all' ||
						(feedFilter === 'authored'
							? labels.includes('Authored')
							: feedFilter === 'mentions'
								? labels.includes('Mentioned')
								: labels.some((label) => label === 'Related' || label === 'About'))
				)
				.map(([id]) => id)
		);
		void search.query(library, personId ? 'all' : view, query, sort).then((value) => {
			if (n !== generation) return;
			results = personId
				? {
						...value,
						items: value.items.filter(
							(i) => i.entityKind === 'bookmark' && connected.has(String(i.id))
						)
					}
				: value;
		});
	});
	const shelfStats = $derived.by(() => {
		const counts: Record<string, number> = {};
		const shelves = { later: 0, people: people.length, trash: 0 };
		for (const row of library.list<Row>('bookmarks')) {
			if (isReadLater(row)) shelves.later++;
			for (const id of (row.tagIds as string[]) ?? []) counts[id] = (counts[id] ?? 0) + 1;
		}
		return { counts, shelves };
	});
	const tagLabels = $derived(new Map(tags.map((t) => [String(t.id), String(t.name)])));
	$effect(() => {
		if (view === 'tags' && query) void navigate('all');
	});
	async function navigate(nextView: string) {
		const url = new SvelteURL(page.url.href);
		url.pathname = resolve('/public');
		if (nextView === 'tags') query = '';
		url.searchParams.set('view', nextView);
		limit = 100;
		if (query) url.searchParams.set('q', query);
		else url.searchParams.delete('q');
		await goto(url, { reset: false });
	}
	async function openSearch() {
		if (mobile) {
			navSearching = true;
			await tick();
		}
		await omnibar?.focusSearch();
	}
	async function openTags() {
		navSearching = false;
		if (view !== 'tags') await navigate('tags');
		await tick();
		tagsExplorer?.focusSearch();
	}
	function focusList() {
		document
			.querySelector<HTMLElement>('.bookmark-title, .person-card')
			?.focus({ preventScroll: true });
	}
	onMount(() => {
		const narrow = window.matchMedia('(max-width: 767px)');
		const layout = () => (mobile = narrow.matches);
		layout();
		narrow.addEventListener('change', layout);
		searcher = createSearchClient();
		const key = libraryKeyboard({
			insert: () => void openSearch(),
			filter: () => void (mobile ? openTags() : sidebar?.focusNavigation()),
			account: () => {},
			help: () => {}
		});
		window.addEventListener('keydown', key);
		return () => {
			narrow.removeEventListener('change', layout);
			window.removeEventListener('keydown', key);
			searcher?.stop();
		};
	});
	const noop = () => {};
</script>

{#snippet omnibarSlot()}<Omnibar
		bind:this={omnibar}
		library={null}
		ready
		readonly
		{tags}
		{people}
		bind:query
		feedback={noop}
		onNormal={focusList}
		onDismiss={() => (navSearching = false)}
	/>{/snippet}
<svelte:head>
	<title>{title} · Prism</title>
	<meta name="robots" content="noindex" />
</svelte:head>
<a class="skip-link" href="#library-main">Skip to content</a>
<div class="library-shell" class:sidebar-collapsed={sidebarCollapsed} class:mobile-layout={mobile}>
	<LibrarySidebar
		bind:this={sidebar}
		view={person ? 'people' : view}
		{tags}
		home="/public"
		bind:collapsed={sidebarCollapsed}
		onSelect={(value) => void navigate(value)}
	/>
	<main id="library-main" class="library-main" tabindex="-1">
		<h1 class="view-title" class:inline-heading={!!person || view === 'tags'}>{title}</h1>
		{#if !mobile}<div class="workspace-search">{@render omnibarSlot()}</div>{/if}
		<div class="library-content">
			{#if view === 'tags'}
				<TagsExplorer
					bind:this={tagsExplorer}
					{tags}
					counts={shelfStats.counts}
					shelves={shelfStats.shelves}
					onSelect={(value) => void navigate(value)}
				/>
			{:else}
				{#if person}<div class="person-profile">
						<div class="profile-cover" aria-hidden="true"></div>
						<PersonAvatar id={String(person.id)} config={person.avatarConfig} size={88} />
						<div class="profile-copy">
							<h2>{person.displayName}</h2>
							{#if person.bio}<p class="person-bio">{person.bio}</p>{/if}{#if personWebsite}<a
									class="source-link"
									href={personWebsite}
									target="_blank"
									rel="noopener noreferrer">{personWebsite}</a
								>{/if}
						</div>
					</div>
					<div class="profile-feed-heading">
						<span>{profileLinks.get(String(person.id))?.size ?? 0} saved connections</span>
						<div class="feed-filters" aria-label="Filter profile feed">
							{#each [{ id: 'all', label: 'All' }, { id: 'authored', label: 'Authored' }, { id: 'related', label: 'Related' }, { id: 'mentions', label: 'Mentions' }] as option (option.id)}<button
									aria-pressed={feedFilter === option.id}
									onclick={() => (feedFilter = option.id)}>{option.label}</button
								>{/each}
						</div>
					</div>{/if}
				<div class="list-toolbar">
					<button
						class="column-sort"
						onclick={() => (sort = sort === 'title' ? 'newest' : 'title')}
						aria-label="Sort by title"
						>{view === 'people' ? 'Name' : 'Title'}{sort === 'title' ? ' ↑' : ''}</button
					>
					{#if query}<span class="muted">{results.items.length} found</span>{/if}
					<DropdownMenu.Root
						><DropdownMenu.Trigger class="column-sort date-sort" aria-label="Sort results"
							>{sort === 'title' ? 'Title A–Z' : 'Created at'}<ChevronDownIcon
							/></DropdownMenu.Trigger
						><DropdownMenu.Portal
							><DropdownMenu.Content class="menu-content" align="end" sideOffset={5}>
								{#each [{ value: 'newest', label: 'Newest first' }, { value: 'title', label: 'Title A–Z' }] as option (option.value)}<DropdownMenu.Item
										class="menu-item"
										onSelect={() => (sort = option.value)}>{option.label}</DropdownMenu.Item
									>{/each}
							</DropdownMenu.Content></DropdownMenu.Portal
						></DropdownMenu.Root
					>
				</div>
				{#if results.error}<p class="notice inset" role="alert">{results.error}</p>{/if}
				<div
					class="bookmark-list"
					class:person-timeline={!!person}
					class:people-grid={view === 'people'}
				>
					{#each results.items.slice(0, limit) as item (String(item.id))}
						{#if item.entityKind === 'person'}<button
								class="person-card"
								onclick={() => void navigate(`person:${item.id}`)}
								><PersonAvatar id={String(item.id)} config={item.avatarConfig} size={56} /><span
									><strong>{item.displayName}</strong><small
										>{item.bio || item.website || 'A person worth keeping up with.'}</small
									><span class="person-count"
										>{profileLinks.get(String(item.id))?.size ?? 0} saved connections</span
									></span
								></button
							>
						{:else}<BookmarkCard
								{item}
								readonly
								note={notePreview(noteBodies.get(String(item.id)) ?? '')}
								timeline={!!person}
								relation={person
									? (profileLinks.get(String(person.id))?.get(String(item.id)) ?? []).join(' · ')
									: ''}
								tagLabels={((item.tagIds as string[]) ?? [])
									.map((id) => tagLabels.get(id) ?? '')
									.filter(Boolean)}
								onEdit={noop}
								onAction={noop}
								onOpen={noop}
							/>{/if}
					{:else}<section class="welcome-panel compact">
							<h2>
								{query
									? 'Nothing matched this search.'
									: view === 'people'
										? 'No people yet.'
										: 'No bookmarks here yet.'}
							</h2>
							{#if query}<p>Try a title, note or #tag.</p>{/if}
						</section>{/each}
				</div>
				{#if results.items.length > limit}<button class="load-more" onclick={() => (limit += 100)}
						>Show more</button
					>{/if}
			{/if}
		</div>
	</main>
	{#if mobile}<MobileNavbar
			view={person ? 'people' : view}
			bind:searching={navSearching}
			onSelect={(value) => void navigate(value)}
			onSearch={() => void openSearch()}
			searchLabel="Search bookmarks"
			omnibar={omnibarSlot}
		/>{/if}
</div>
