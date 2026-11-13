<script lang="ts">
	import {
		Bookmark as BookmarkIcon,
		ChevronDown as ChevronDownIcon,
		X as XIcon,
		Check,
		Keyboard,
		Link2,
		Lock,
		Globe,
		Trash2,
		UserPlus
	} from '@lucide/svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- Source links use validated external HTTP URLs. App navigation uses resolve. */
	import { onMount, tick } from 'svelte';
	import { autosize } from '#lib/client/attachments.js';
	import { downloadFile } from '#lib/client/download.js';
	import AccountPanel from './AccountPanel.svelte';
	import KeyboardHelp from './KeyboardHelp.svelte';
	import MovePalette from './MovePalette.svelte';
	import { libraryKeyboard } from '#lib/client/keyboard-navigation.js';
	import { MediaQuery, SvelteURL } from 'svelte/reactivity';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { AlertDialog, Dialog, DropdownMenu } from 'bits-ui';
	import Omnibar from './Omnibar.svelte';
	import LibrarySidebar from './LibrarySidebar.svelte';
	import MobileNavbar from './MobileNavbar.svelte';
	import PersonAvatar from './ui/PersonAvatar.svelte';
	import PersonHeader from './people/PersonHeader.svelte';
	import PersonRow from './people/PersonRow.svelte';
	import { connectionIndex } from '#lib/client/people-feed.js';
	import { cue } from '#lib/client/sounds.svelte.js';
	import TokenInput from './ui/TokenInput.svelte';
	import Toast, { type Notice } from './ui/Toast.svelte';
	import BookmarkCard from './BookmarkCard.svelte';
	import PostCard, { type PostPerson } from './PostCard.svelte';
	import { formatPersonLinks, parsePersonLinks } from '#lib/domain/person-links.js';
	import { notePreview } from '#lib/client/reference-edits.js';
	import { tweetStatusId } from '#lib/domain/tweets.js';
	import { personPhoto } from '#lib/client/avatars.js';
	import {
		bookmarkSource,
		chunked,
		copyLink,
		isReadLater,
		moveTag,
		planMove,
		personLinksIndex,
		personSlug,
		personIdFromSlug,
		syncPersonLinks,
		tagIdFromSlug,
		tagSlug,
		xHandle
	} from '#lib/client/workflows.js';
	import { sortByPosition } from '#lib/domain/organization.js';

	import { createLibraryClient, type LibraryClient } from '#lib/client/vault/library.js';
	import { createSearchClient } from '#lib/client/search-client.js';
	import { perfMark } from '#lib/client/perf.js';
	import { emptySearch, type searchLibrary } from '#lib/client/search.js';
	// Import/export loads on first use, keeping it out of the initial library bundle.
	import type { ImportResult, previewImport } from '#lib/client/vault/portability.js';
	const portability = () => import('#lib/client/vault/portability.js');
	const browserBookmarks = () => import('#lib/client/vault/browser-bookmarks.js');
	import type { BrowserImportPlan } from '#lib/client/vault/browser-bookmarks.js';
	import BrowserImportDialog from './BrowserImportDialog.svelte';
	import type { EntityRef } from '#lib/domain/entities.js';
	import type { VaultIdentity } from '#lib/domain/replica.js';
	import {
		MAX_BULK_BOOKMARKS,
		type BulkBookmarkCommand,
		type Command,
		type Revision
	} from '#lib/domain/contracts.js';
	import LibraryInspector from './LibraryInspector.svelte';
	import TagsExplorer from './TagsExplorer.svelte';
	let {
		openOffline = false,
		identity = null,
		personSlug: profileSlug = ''
	}: { openOffline?: boolean; identity?: VaultIdentity | null; personSlug?: string } = $props();

	type Row = Record<string, unknown>;
	// The facade owns its mutable state and notifies via version; do not proxy its snapshots.
	let library = $state.raw<LibraryClient | null>(null),
		version = $state(0),
		sort = $state('newest'),
		notice = $state<Notice | null>(null),
		creating = $state(false),
		formBusy = $state(false),
		importBusy = $state(false),
		formError = $state('');
	let newType = $state('person'),
		newTitle = $state(''),
		newNote = $state(''),
		personUrl = $state(''),
		editingPerson = $state<Row | null>(null);
	let captureId = $state('');
	let sidebarCollapsed = $state(false),
		navSearching = $state(false);
	const narrow = new MediaQuery('max-width: 767px'),
		wide = new MediaQuery('min-width: 1200px');
	const mobile = $derived(narrow.current),
		wideEditor = $derived(wide.current);
	let results = $state<ReturnType<typeof searchLibrary>>({ items: [], filter: emptySearch() }),
		limit = $state(100);
	let importData = $state<unknown>(null),
		importOpen = $state(false),
		importReport = $state<ImportResult | null>(null),
		importProgress = $state(''),
		importPreview = $state<ReturnType<typeof previewImport> | null>(null),
		browserPlan = $state.raw<BrowserImportPlan | null>(null),
		browserImportOpen = $state(false);
	let settings = $state(false),
		purgeOpen = $state(false),
		purgeTarget = $state<Row | null>(null),
		manage = $state<{ table: 'tags'; row: Row } | null>(null),
		rename = $state(''),
		deleteArmed = $state(false);
	let omnibar: Omnibar | undefined = $state();
	let sidebar: LibrarySidebar | undefined = $state();
	let tagsExplorer: TagsExplorer | undefined = $state();
	let helpOpen = $state(false);
	// Visual mode's marked run, and the bookmarks `x` cut, waiting for a destination.
	let marked = $state<string[]>([]),
		moving = $state<string[]>([]),
		moveOpen = $state(false);
	const markedSet = $derived(new Set(marked));
	$effect(() => {
		if (!moveOpen) marked = [];
	});
	let lastRow: HTMLElement | null = null;
	let noticeId = 0;
	const toast = $derived(notice?.message ?? '');
	let pendingResults: Promise<void> | undefined;
	async function focusLibrary() {
		const initial = lastRow?.isConnected
			? lastRow
			: document.querySelector<HTMLElement>('.bookmark-title, .person-card');
		const fallback = document.getElementById('library-main');
		(initial ?? fallback)?.focus({ preventScroll: true });
		await tick();
		await pendingResults;
		await tick();
		// A search may finish after Escape. Restore a row only if the user has
		// not already moved focus elsewhere while those results were loading.
		if (document.activeElement !== fallback && document.activeElement !== document.body) return;
		const row = lastRow?.isConnected
			? lastRow
			: document.querySelector<HTMLElement>('.bookmark-title, .person-card');
		(row ?? document.getElementById('library-main'))?.focus({ preventScroll: true });
	}
	let editorReturnId = '';
	$effect(() => {
		if (selected) editorReturnId = selected.id;
	});
	let searcher: ReturnType<typeof createSearchClient> | undefined,
		generation = 0;
	const status = $derived.by(() => {
		void version;
		return library ? { ...library.state } : null;
	});
	const contentVersion = $derived(status?.contentVersion ?? 0);
	const libraryReady = $derived(status?.ready ?? false);
	const personId = $derived(personIdFromSlug(profileSlug));
	const tags = $derived.by(() => {
		void version;
		return sortByPosition(library?.list<Row>('tags').filter((r) => !r.deletedAt) ?? []);
	});
	// Tag pages live at `?tag=<name>`; `view=tag:<id>` is the old form, still accepted.
	const requestedTag = $derived(page.url.searchParams.get('tag'));
	const requestedView = $derived(
		requestedTag
			? `tag:${tagIdFromSlug(requestedTag, tags) ?? requestedTag}`
			: (page.url.searchParams.get('view') ?? 'all')
	);
	const view = $derived(
		profileSlug
			? 'person'
			: ['all', 'later', 'trash', 'people', 'tags'].includes(requestedView) ||
				  requestedView.startsWith('tag:')
				? requestedView
				: 'all'
	);
	const people = $derived.by(() => {
		void version;
		return library?.list<Row>('people').filter((p) => !p.deletedAt && !p.purgedAt) ?? [];
	});
	const person = $derived(people.find((p) => p.id === personId));
	const personWebsite = $derived.by(() => {
		try {
			return normalizeUrl(String(person?.website)).url;
		} catch {
			return null;
		}
	});
	const noteBodies = $derived.by(() => {
		void version;
		return new Map(
			library?.list<Row>('notes').map((n) => [String(n.entityId), String(n.bodyMarkdown)]) ?? []
		);
	});
	const selected = $derived.by(() => {
		const id = page.url.searchParams.get('item'),
			kind = page.url.searchParams.get('kind');
		return id && kind === 'bookmark' ? ({ id, kind } as EntityRef) : null;
	});
	const title = $derived(
		(view === 'person' ? (person?.displayName ?? 'Person') : undefined) ??
			(
				{
					all: 'All bookmarks',
					later: 'Read later',
					trash: 'Trash',
					people: 'People',
					tags: 'Tags'
				} as Record<string, string>
			)[view] ??
			(view.startsWith('tag:') ? tags.find((t) => t.id === view.slice(4))?.name : undefined) ??
			'Library'
	);
	// Person → connected bookmarks. Only the people pages need it.
	const connections = $derived.by(() => {
		void contentVersion;
		return connectionIndex(view === 'people' || profileSlug ? library : null);
	});
	// People has two tabs: the feed, everything connected to anyone newest first, and the
	// directory of the people themselves.
	const peopleTab = $derived(
		view === 'people' && ['directory', 'explore'].includes(page.url.searchParams.get('tab') ?? '')
			? 'directory'
			: 'feed'
	);
	const feedMode = $derived(!!profileSlug || (view === 'people' && peopleTab === 'feed'));
	// The people feed shows what is connected to someone, or every saved post from X as well,
	// connected or not. Kept in the URL like the tab, so it survives reloads and back.
	const feedScope = $derived(
		view === 'people' && peopleTab === 'feed' && page.url.searchParams.get('feed') === 'all'
			? 'all'
			: 'connected'
	);
	async function setFeedScope(scope: 'connected' | 'all') {
		const url = new SvelteURL(page.url.href);
		if (scope === 'all') url.searchParams.set('feed', 'all');
		else url.searchParams.delete('feed');
		limit = 100;
		await goto(url, { reset: false });
	}
	const identityIndex = $derived.by(() => {
		void version;
		return personLinksIndex(library);
	});
	const peopleById = $derived(new Map(people.map((p) => [String(p.id), p])));
	const handleOf = (id: string) => xHandle(identityIndex.get(id));
	// Their profile photo, from whichever of their links can give one.
	const photoOf = (id: string) =>
		personPhoto(id, identityIndex.get(id), peopleById.get(id)?.website);
	const createdAt = $derived.by(() => {
		void contentVersion;
		if (!connections.size) return new Map<string, string>();
		return new Map(
			(library?.list<Row>('bookmarks') ?? []).map((b) => [String(b.id), String(b.createdAt)])
		);
	});
	// Bookmark → the people connected to it, by name.
	const peopleOnPost = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Rebuilt whole on every derivation.
		const byPost = new Map<string, PostPerson[]>();
		for (const [id, bookmarkIds] of connections) {
			const row = peopleById.get(id);
			if (!row) continue;
			for (const bookmarkId of bookmarkIds) {
				const list = byPost.get(bookmarkId) ?? [];
				list.push({
					id,
					name: String(row.displayName),
					handle: handleOf(id),
					photo: photoOf(id)
				});
				byPost.set(bookmarkId, list);
			}
		}
		for (const list of byPost.values()) list.sort((a, b) => a.name.localeCompare(b.name));
		return byPost;
	});
	// When each person last had a link connected; the directory and the strip sort by it.
	const lastAdded = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Rebuilt whole on every derivation.
		const latest = new Map<string, string>();
		for (const [id, bookmarkIds] of connections)
			for (const bookmarkId of bookmarkIds) {
				const at = createdAt.get(bookmarkId) ?? '';
				if (at > (latest.get(id) ?? '')) latest.set(id, at);
			}
		return latest;
	});
	const recentPeople = $derived(
		view === 'people'
			? people
					.filter((p) => lastAdded.has(String(p.id)))
					.sort((a, b) =>
						(lastAdded.get(String(b.id)) ?? '').localeCompare(lastAdded.get(String(a.id)) ?? '')
					)
					.slice(0, 12)
			: []
	);
	const profileLinksList = $derived(person ? (identityIndex.get(String(person.id)) ?? []) : []);
	async function setPeopleTab(tab: 'feed' | 'directory') {
		const url = new SvelteURL(page.url.href);
		if (tab === 'directory') url.searchParams.set('tab', 'directory');
		else url.searchParams.delete('tab');
		limit = 100;
		await goto(url, { reset: false });
	}
	let query = $derived(page.url.searchParams.get('q') ?? '');
	let content: HTMLElement | undefined = $state();
	// On mobile the search field is at the bottom, so ranked results read upward from it.
	const bottomUp = $derived(mobile && !!query && view !== 'people' && !profileSlug);
	$effect(() => {
		if (!bottomUp) return;
		void results;
		void tick().then(() => content?.scrollTo({ top: content.scrollHeight }));
	});
	$effect(() => {
		void contentVersion;
		const current = library,
			search = searcher;
		if (!current || !libraryReady || !search || view === 'tags') return;
		const n = ++generation;
		// A profile shows one person's connections; the people feed shows everyone's.
		const connected = new Set(
			personId
				? (connections.get(personId) ?? [])
				: feedMode
					? [...connections.values()].flatMap((set) => [...set])
					: []
		);
		const filterFeed = feedMode;
		const allPosts = feedScope === 'all' && !profileSlug;
		// The directory lists people by their latest connection, unless sorted by name.
		const byActivity = view === 'people' && !feedMode && sort !== 'title' && !query;
		const recency = lastAdded;
		// One copy of the library per content version; view, query and sort changes reuse it.
		search.setSnapshot(current, contentVersion);
		pendingResults = search
			.query(filterFeed && !profileSlug ? 'all' : view, query, sort)
			.then((value) => {
				if (n === generation)
					results = filterFeed
						? {
								...value,
								items: value.items.filter(
									(i) =>
										i.entityKind === 'bookmark' &&
										(connected.has(String(i.id)) ||
											(allPosts && !!tweetStatusId(bookmarkSource(i))))
								)
							}
						: byActivity
							? {
									...value,
									items: [...value.items].sort(
										(x, y) =>
											(recency.get(String(y.id)) ?? '').localeCompare(
												recency.get(String(x.id)) ?? ''
											) || String(x.displayName).localeCompare(String(y.displayName))
									)
								}
							: value;
			})
			.catch((e) => {
				if (n === generation) feedback((e as Error).message);
			});
	});
	// Effects run after the DOM update, so this marks the first rendered library row.
	$effect(() => {
		if (results.items.length) perfMark('first-bookmark-rendered', { items: results.items.length });
	});
	onMount(() => {
		searcher = createSearchClient();
		const client = createLibraryClient(() => {
			version++;
		});
		library = client;
		void client.start(identity ?? undefined).then(() => {
			if (openOffline) return client.openCached().catch((error: Error) => feedback(error.message));
		});
		const key = libraryKeyboard({
			insert: () => void openOmnibar('insert'),
			filter: () => void (mobile ? openTags() : sidebar?.focusNavigation()),
			account: () => (settings = true),
			help: () => (helpOpen = true),
			mark: (ids) => (marked = ids),
			cut: (ids) => openMove(ids),
			remove: (ids) => trashMany(ids),
			copy: (ids) => void copyMany(ids)
		});
		const remember = (event: FocusEvent) => {
			const target = event.target as HTMLElement;
			if (target.matches('.bookmark-title, .person-card')) lastRow = target;
		};
		window.addEventListener('keydown', key);
		window.addEventListener('focusin', remember);
		return () => {
			window.removeEventListener('keydown', key);
			window.removeEventListener('focusin', remember);
			client.stop();
			searcher?.stop();
		};
	});
	// On mobile the omnibar lives in the bottom navbar and must be revealed before it can take focus.
	async function openOmnibar(next: 'insert' | 'search') {
		if (mobile) {
			navSearching = true;
			await tick();
		}
		await (next === 'insert' ? omnibar?.focusInsert() : omnibar?.focusSearch());
	}
	async function openTags() {
		navSearching = false;
		if (view !== 'tags') await navigate(null, 'tags');
		await tick();
		tagsExplorer?.focusSearch();
	}
	// Toasts are for what the screen can't show by itself: errors, destructive actions and
	// background work. Routine saves confirm themselves in the list.
	function feedback(message: string) {
		notice = { id: ++noticeId, message };
	}
	async function navigate(target: EntityRef | null, nextView?: string) {
		if (target?.kind === 'person') {
			const row = library?.get<Row>('people', target.id);
			if (row) await goto(resolve('/people/[slug]', { slug: personSlug(row) }));
			return;
		}
		if (target?.kind === 'persona') return;
		const url = new SvelteURL(page.url.href);
		if (nextView) url.pathname = resolve('/');
		// The tags page filters its own list; a leftover library search would send it back to all.
		if (nextView === 'tags') query = '';
		if (nextView) {
			// Read live rows, not `tags`: a rename has to reach the address straight away.
			const live = library?.list<Row>('tags').filter((r) => !r.deletedAt) ?? tags;
			const tag = nextView.startsWith('tag:')
				? live.find((t) => t.id === nextView.slice(4))
				: undefined;
			if (tag) {
				url.searchParams.set('tag', tagSlug(tag, live));
				url.searchParams.delete('view');
			} else {
				url.searchParams.set('view', nextView);
				url.searchParams.delete('tag');
			}
			url.searchParams.delete('item');
			url.searchParams.delete('kind');
			limit = 100;
		}
		if (target) {
			url.searchParams.set('item', target.id);
			url.searchParams.set('kind', target.kind);
		} else if (!nextView) {
			url.searchParams.delete('item');
			url.searchParams.delete('kind');
		}
		if (query) url.searchParams.set('q', query);
		else url.searchParams.delete('q');
		await goto(url, { reset: false });
	}
	// Tag counts and shelf sizes for the tags page, from live bookmark rows.
	const shelfStats = $derived.by(() => {
		void version;
		const counts: Record<string, number> = {};
		// Counted on every view now: the sidebar shows them too. One pass over the bookmarks.
		const shelves = { all: 0, later: 0, people: people.length, trash: 0 };
		for (const row of library?.list<Row>('bookmarks') ?? []) {
			if (row.purgedAt) continue;
			if (row.deletedAt) {
				shelves.trash++;
				continue;
			}
			shelves.all++;
			if (isReadLater(row)) shelves.later++;
			for (const id of (row.tagIds as string[]) ?? []) counts[id] = (counts[id] ?? 0) + 1;
		}
		return { counts, shelves };
	});
	// The tags page has no bookmark list, so a library search moves back to all bookmarks.
	$effect(() => {
		if (view === 'tags' && query) void navigate(null, 'all');
	});
	function create(type: string, name = '') {
		if (formBusy) return;
		if (type === 'bookmark') {
			void openOmnibar('insert');
			return;
		}
		if (!['person', 'tag'].includes(type)) return;
		newType = type;
		personUrl = '';
		editingPerson = null;
		captureId = crypto.randomUUID();
		newTitle = name;
		newNote = '';
		formError = '';
		creating = true;
	}
	function editPerson() {
		if (!person) return;
		create('person');
		editingPerson = person;
		newTitle = String(person.displayName);
		personUrl = formatPersonLinks(
			person.website ? String(person.website) : null,
			(identityIndex.get(String(person.id)) ?? []).map((row) => ({
				platform: String(row.platform),
				profileUrl: String(row.profileUrl),
				handle: row.handle ? String(row.handle) : null
			}))
		);
		newNote = String(person.bio ?? '');
	}
	async function submitCreate(event: SubmitEvent) {
		event.preventDefault();
		if (!library || formBusy) return;
		formBusy = true;
		formError = '';
		const id = editingPerson ? String(editingPerson.id) : captureId;
		try {
			// `@username, site.com, github.com/name`: the first plain site is the website, the
			// rest become profile links. Parse first so a typo saves nothing.
			const links = newType === 'person' ? parsePersonLinks(personUrl) : null;
			const command: Command =
				newType === 'person'
					? editingPerson
						? {
								type: 'person.update',
								id,
								expectedRevision: String(editingPerson.revision) as Revision,
								patch: {
									displayName: newTitle,
									website: links?.website ?? null,
									bio: newNote
								}
							}
						: {
								type: 'person.create',
								id,
								displayName: newTitle,
								website: links?.website ?? null,
								bio: newNote
							}
					: { type: 'tag.create', id, name: newTitle };
			const result = await library.save(command);
			if (result.status === 'rejected') throw new Error(result.message ?? 'Could not save.');
			if (links)
				try {
					await syncPersonLinks(library, id, links.links);
				} catch (error) {
					// The person is saved; reopen as an edit of the saved row so a retry only
					// touches the links.
					editingPerson = library.get<Row>('people', id) ?? editingPerson;
					throw error;
				}
			creating = false;
			cue('success');
			if (newType === 'person') await navigate({ kind: 'person', id });
			else await navigate(null, `tag:${id}`);
		} catch (e) {
			formError = (e as Error).message;
			cue('error');
		} finally {
			formBusy = false;
		}
	}
	// A new list is a new set of rows; a marked run from the old one means nothing here.
	$effect(() => {
		void view;
		void query;
		marked = [];
	});
	// One command for one bookmark, otherwise bulk commands of at most MAX_BULK_BOOKMARKS each.
	async function saveMany(commands: BulkBookmarkCommand[]) {
		if (!library || !commands.length) return;
		for (const chunk of chunked(commands, MAX_BULK_BOOKMARKS)) {
			const result = await library.save(
				chunk.length === 1 ? chunk[0] : { type: 'bookmark.bulk', commands: chunk }
			);
			if (result.status === 'rejected') throw new Error(result.message ?? 'Could not save.');
		}
	}
	const plural = (n: number) => (n === 1 ? 'bookmark' : `${n} bookmarks`);
	function openMove(ids: string[]) {
		if (view === 'trash') {
			feedback('Restore bookmarks before moving them.');
			cue('error');
			return;
		}
		moving = ids;
		marked = ids;
		moveOpen = true;
	}
	// The tag page being cut from, if any: moving takes this tag off.
	const moveSource = $derived(view.startsWith('tag:') ? view.slice(4) : null);
	async function moveTo(tagId: string) {
		if (!library) return;
		const rows = moving
			.map((id) => library!.get<Row>('bookmarks', id))
			.filter((row): row is Row => !!row);
		const { adds, removes } = planMove(rows, tagId, moveSource);
		const name = tags.find((t) => t.id === tagId)?.name ?? 'tag';
		try {
			await saveMany(adds);
			await saveMany(removes);
			cue('success');
			feedback(`${moveSource ? 'Moved' : 'Added'} ${plural(rows.length)} to #${name}.`);
		} catch (error) {
			cue('error');
			feedback((error as Error).message);
		} finally {
			moving = [];
		}
	}
	async function createAndMove(name: string) {
		if (!library) return;
		const id = crypto.randomUUID();
		const result = await library.save({ type: 'tag.create', id, name });
		if (result.status === 'rejected') {
			cue('error');
			feedback(result.message ?? 'Could not create this tag.');
			moving = [];
			return;
		}
		await moveTo(id);
	}
	async function trashMany(ids: string[]) {
		if (!library) return;
		if (view === 'trash') {
			feedback('Already in trash. Delete permanently from the menu.');
			return;
		}
		const rows = ids
			.map((id) => library!.get<Row>('bookmarks', id))
			.filter((row): row is Row => !!row && !row.deletedAt);
		try {
			await saveMany(
				rows.map((row) => ({
					type: 'bookmark.trash',
					id: String(row.id),
					expectedRevision: String(row.revision) as Revision
				}))
			);
			cue('warning');
			feedback(`Moved ${plural(rows.length)} to trash.`);
		} catch (error) {
			cue('error');
			feedback((error as Error).message);
		}
	}
	async function copyMany(ids: string[]) {
		const links = ids
			.map((id) => library?.get<Row>('bookmarks', id))
			.map((row) => (row ? bookmarkSource(row) : null))
			.filter((url): url is string => !!url);
		if (!links.length) return;
		if (links.length === 1) return copyLink(links[0], feedback);
		try {
			await navigator.clipboard.writeText(links.join('\n'));
			feedback(`Copied ${links.length} links.`);
		} catch {
			feedback('Could not copy the links.');
		}
	}
	async function bookmarkAction(item: Row, action: 'later' | 'trash' | 'restore' | 'purge') {
		if (!library) return;
		const row = library.get<Row>('bookmarks', String(item.id));
		if (!row) return;
		if (action === 'purge') {
			purgeTarget = row;
			purgeOpen = true;
			return;
		}
		const command: Command =
			action === 'trash' || action === 'restore'
				? {
						type: `bookmark.${action}`,
						id: String(row.id),
						expectedRevision: String(row.revision) as Revision
					}
				: {
						type: 'bookmark.organize',
						id: String(row.id),
						expectedRevision: String(row.revision) as Revision,
						patch: { readingStatus: isReadLater(row) ? 'unread' : 'reading' }
					};
		try {
			const result = await library.save(command);
			cue(result.status === 'rejected' ? 'error' : action === 'trash' ? 'warning' : 'success');
			if (result.status === 'rejected') feedback(result.message ?? 'Could not save this change.');
			else if (action === 'trash') feedback('Moved to trash.');
		} catch (error) {
			cue('error');
			feedback((error as Error).message);
		}
	}
	async function purgeBookmark() {
		const target = purgeTarget;
		// AlertDialog.Action does not close the dialog by itself.
		purgeOpen = false;
		if (!library || !target) return;
		const row = library.get<Row>('bookmarks', String(target.id));
		if (!row) return;
		try {
			const result = await library.save({
				type: 'bookmark.purge',
				id: String(row.id),
				expectedRevision: String(row.revision) as Revision
			});
			if (result.status === 'rejected')
				throw new Error(result.message ?? 'Could not delete bookmark.');
			cue('success');
			feedback('Deleted permanently.');
		} catch (error) {
			cue('error');
			feedback((error as Error).message);
		} finally {
			purgeTarget = null;
		}
	}
	async function connectContent(id: string) {
		if (!library || !personId) return;
		const result = await library.save({
			type: 'content-person.add',
			bookmarkId: id,
			personId,
			role: 'related',
			provenance: 'manual'
		});
		if (result.status === 'rejected')
			throw new Error(result.message ?? 'Could not connect bookmark.');
	}
	async function disconnectContent(id: string) {
		if (!library || !personId) return;
		for (const row of library
			.list<Row>('relationships')
			.filter((r) => !r.deletedAt && r.personId === personId && r.bookmarkId === id)) {
			const result = await library.save({
				type: 'content-person.remove',
				bookmarkId: id,
				personId,
				role: row.role as 'related'
			});
			if (result.status === 'rejected')
				throw new Error(result.message ?? 'Could not disconnect bookmark.');
		}
	}
	const connectedIds = $derived.by(() => {
		void version;
		return [
			...new Set(
				library
					?.list<Row>('relationships')
					.filter((r) => !r.deletedAt && r.personId === personId)
					.map((r) => String(r.bookmarkId)) ?? []
			)
		];
	});
	// Typing the name of a tag that already exists offers that tag instead of an error.
	const existingTag = $derived.by(() => {
		if (newType !== 'tag' || !newTitle.trim()) return undefined;
		const name = newTitle.trim().replace(/^#/, '').toLocaleLowerCase();
		return tags.find((t) => String(t.name).toLocaleLowerCase() === name);
	});
	const renamed = $derived(
		!!manage && !!rename.trim() && rename.trim() !== String(manage.row.name)
	);
	function openManage(entry: { table: 'tags'; row: Row }) {
		manage = entry;
		rename = String(entry.row.name);
		deleteArmed = false;
	}
	// The tag being edited as it is now, so privacy reflects saves from here or other devices.
	const managed = $derived.by(() => {
		void version;
		return manage ? (library?.get<Row>('tags', String(manage.row.id)) ?? manage.row) : null;
	});
	const managedPrivate = $derived(managed?.isPrivate === true);
	let privacyBusy = $state(false);
	// A private tag, and everything carrying it, is left out of the public page. Saved at once,
	// independently of renaming.
	async function togglePrivacy() {
		if (!library || !managed || privacyBusy) return;
		privacyBusy = true;
		try {
			const outcome = await library.save({
				type: 'tag.privacy',
				id: String(managed.id),
				expectedRevision: String(managed.revision) as Revision,
				isPrivate: managed.isPrivate !== true
			});
			if (outcome.status === 'rejected') {
				feedback(outcome.message ?? 'Could not change this tag.');
				cue('error');
			}
		} finally {
			privacyBusy = false;
		}
	}
	const contentChoices = $derived.by(() => {
		void version;
		return (
			library
				?.list<Row>('bookmarks')
				.filter((r) => !r.deletedAt && !r.purgedAt)
				.map((r) => ({
					value: String(r.id),
					label: String(r.title),
					search: String(r.description ?? '') + ' ' + String(noteBodies.get(String(r.id)) ?? '')
				})) ?? []
		);
	});

	function download(value: unknown, name: string) {
		downloadFile(
			typeof value === 'string' ? value : JSON.stringify(value, null, 2),
			name,
			'application/json'
		);
	}
	async function exportData() {
		if (!library) return;
		try {
			const { exportLibrary } = await portability();
			download(
				await exportLibrary(library),
				`prism-v0-${new Date().toISOString().slice(0, 10)}.json`
			);
			feedback('Metadata exported. Media bytes are not included.');
		} catch (e) {
			feedback((e as Error).message);
		}
	}
	async function exportBrowserData() {
		if (!library) return;
		try {
			const { exportBrowserBookmarks } = await browserBookmarks();
			const result = exportBrowserBookmarks(library);
			downloadFile(
				result.html,
				`prism-bookmarks-${new Date().toISOString().slice(0, 10)}.html`,
				'text/html'
			);
			const notes = [
				result.withoutUrl &&
					`${result.withoutUrl} notes and rabbit holes without a link stay in the Prism JSON export`,
				result.privateTagsOmitted && 'private tag names were left out'
			].filter(Boolean);
			feedback(
				`Exported ${result.exported.toLocaleString()} bookmarks${notes.length ? `; ${notes.join('; ')}` : ''}.`
			);
		} catch (e) {
			feedback((e as Error).message);
		}
	}
	async function pickImport(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !library) return;
		if (file.size > 10 * 1024 * 1024) {
			feedback('Choose an import file smaller than 10 MiB.');
			return;
		}
		let modules: [
			Awaited<ReturnType<typeof portability>>,
			Awaited<ReturnType<typeof browserBookmarks>>
		];
		try {
			modules = await Promise.all([portability(), browserBookmarks()]);
		} catch {
			feedback('Import could not load. Check your connection and try again.');
			return;
		}
		const [{ detectImportFormat, previewImport: preview }, { planBrowserImport }] = modules;
		try {
			const text = await file.text();
			// The contents decide the importer; a renamed file or a wrong MIME type doesn't matter.
			if (detectImportFormat(text) === 'browser-html') {
				browserPlan = await planBrowserImport(library, text, file.name);
				browserImportOpen = true;
				return;
			}
			importData = JSON.parse(text);
			importPreview = preview(importData);
			importReport = null;
			importOpen = true;
		} catch (e) {
			feedback((e as Error).message);
		}
	}
	async function runImport() {
		if (!library) return;
		importBusy = true;
		try {
			const { importLibrary } = await portability();
			importReport = await importLibrary(
				library,
				importData,
				(p) => (importProgress = `${p.phase}: ${p.accepted} accepted, ${p.skipped} skipped`)
			);
			feedback(
				importReport.status === 'complete'
					? 'Import finished. Review its report.'
					: 'Import stopped. Download the report before retrying.'
			);
		} catch (e) {
			feedback((e as Error).message);
		} finally {
			importBusy = false;
		}
	}
	async function runMaintenance() {
		try {
			const response = await fetch('/api/v1/maintenance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ limit: 10 })
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.message ?? 'Maintenance could not run.');
			feedback(
				`Cleanup: ${data.completed} complete, ${data.pending} pending, ${data.failed} failed in this run.`
			);
		} catch (e) {
			feedback((e as Error).message);
		}
	}
	async function manageSave(remove = false) {
		if (!library || !manage) return;
		const entry = manage;
		const id = String(entry.row.id);
		try {
			if (remove) {
				// The server refuses to delete a tag that still has members, so detach it first.
				for (const table of ['bookmarks', 'people', 'personas'] as const)
					for (const row of library.list<Row>(table)) {
						if (row.purgedAt || !((row.tagIds as string[] | undefined) ?? []).includes(id))
							continue;
						const result = await library.save({
							type: 'tag.remove',
							id: String(row.id),
							tagId: id
						});
						if (result.status === 'rejected')
							throw new Error(result.message ?? 'Could not remove this tag from every item.');
					}
			}
			const viewing = view === `tag:${id}`;
			const current = library.get<Row>('tags', id) ?? entry.row;
			const command: Command = remove
				? {
						type: 'tag.delete',
						id,
						expectedRevision: String(current.revision) as Revision
					}
				: {
						type: 'tag.rename',
						id,
						expectedRevision: String(current.revision) as Revision,
						name: rename
					};
			const outcome = await library.save(command);
			if (outcome.status === 'rejected') {
				feedback(outcome.message ?? 'Could not save this tag.');
				cue('error');
				return;
			}
			if (remove) feedback('Tag deleted.');
			cue(remove ? 'warning' : 'success');
			manage = null;
			// The address carries the tag's name, so a rename moves it along.
			if (viewing) await navigate(null, remove ? 'tags' : `tag:${id}`);
		} catch (e) {
			cue('error');
			feedback((e as Error).message);
		}
	}
</script>

{#snippet omnibarSlot()}<Omnibar
		bind:this={omnibar}
		{library}
		ready={!!status?.ready}
		{tags}
		{people}
		bind:query
		{personId}
		onNormal={focusLibrary}
		onDismiss={() => (navSearching = false)}
		dismissible={mobile}
		onOpenItem={(id) => {
			navSearching = false;
			void navigate({ kind: 'bookmark', id });
		}}
	/>{/snippet}
<svelte:head
	>{#if profileSlug}<title>{person?.displayName ?? 'Person'} · Prism</title>{/if}</svelte:head
>
<a class="skip-link" href="#library-main">Skip to content</a>
<div
	class="library-shell"
	class:sidebar-collapsed={sidebarCollapsed}
	class:editor-open={!!selected}
	class:mobile-layout={mobile}
>
	<LibrarySidebar
		bind:this={sidebar}
		view={profileSlug ? 'people' : view}
		{tags}
		counts={status?.ready ? shelfStats : undefined}
		bind:collapsed={sidebarCollapsed}
		onSelect={(value) => void navigate(null, value)}
		onCreate={create}
		onAccount={() => (settings = true)}
		onReorder={async (id, toIndex) => {
			if (!library) return;
			try {
				await moveTag(library, tags, id, toIndex);
			} catch (e) {
				cue('error');
				feedback((e as Error).message);
			}
		}}
	/>
	<main id="library-main" class="library-main" tabindex="-1">
		<h1 class="view-title" class:inline-heading={!!profileSlug || view === 'tags'}>{title}</h1>
		{#if !mobile}<div class="workspace-search">{@render omnibarSlot()}</div>{/if}
		<div class="library-content" class:results-bottom-up={bottomUp} bind:this={content}>
			{#if profileSlug && person}<PersonHeader
					{person}
					website={personWebsite}
					links={profileLinksList}
					count={connections.get(String(person.id))?.size ?? 0}
					photo={photoOf(String(person.id))}
					onBack={() => void navigate(null, 'people')}
					onEdit={editPerson}
				/>
				{#if status?.ready}<section class="person-connect">
						<Link2 class="person-connect-icon" aria-hidden="true" />
						<TokenInput
							label="Connect saved links"
							placeholder="Connect a saved link…"
							showSelected={false}
							items={contentChoices}
							selected={connectedIds}
							onAdd={connectContent}
							onRemove={disconnectContent}
						/>
					</section>{/if}{/if}
			{#if view === 'people' && status?.ready}<div class="people-bar">
					<div class="people-tabs" role="tablist" aria-label="People">
						<button
							role="tab"
							aria-selected={peopleTab === 'feed'}
							onclick={() => setPeopleTab('feed')}>Feed</button
						><button
							role="tab"
							aria-selected={peopleTab === 'directory'}
							onclick={() => setPeopleTab('directory')}
							>People{#if people.length}<span>{people.length}</span>{/if}</button
						>
					</div>
					{#if peopleTab === 'feed'}<div
							class="feed-scope"
							role="radiogroup"
							aria-label="Feed shows"
							data-scope={feedScope}
						>
							<span class="feed-scope-thumb" aria-hidden="true"></span>
							<button
								role="radio"
								aria-checked={feedScope === 'connected'}
								title="Links connected to people"
								onclick={() => void setFeedScope('connected')}>Connected</button
							><button
								role="radio"
								aria-checked={feedScope === 'all'}
								title="Every saved post from X, connected or not"
								onclick={() => void setFeedScope('all')}>All posts</button
							>
						</div>{/if}
					{#if peopleTab === 'directory' && people.length > 1}<button
							class="column-sort"
							onclick={() => (sort = sort === 'title' ? 'newest' : 'title')}
							>{sort === 'title' ? 'A–Z' : 'Recent'}</button
						>{/if}
					<button class="text-button people-add" onclick={() => create('person')}
						><UserPlus />Add</button
					>
				</div>
				{#if peopleTab === 'feed' && !query && recentPeople.length > 1}<nav
						class="people-strip"
						aria-label="Recently connected people"
					>
						{#each recentPeople as entry (String(entry.id))}<button
								onclick={() => navigate({ kind: 'person', id: String(entry.id) })}
								title={String(entry.displayName)}
								><PersonAvatar
									name={String(entry.displayName)}
									photo={photoOf(String(entry.id))}
									size={40}
								/><span>{String(entry.displayName).split(' ')[0]}</span></button
							>{/each}
					</nav>{/if}
			{/if}

			{#if !status?.ready}<section class="welcome-panel">
					<div class="empty-icon"><BookmarkIcon /></div>
					<h2>
						{status?.loading ? 'Opening your library…' : 'Your bookmarks, together.'}
					</h2>
					<p>Save links, add context, find them when you need them.</p>
					{#if status?.error}<p class="form-error" role="alert">
							{status.error}
						</p>{/if}{#if !status?.loading}<a class="primary-button" href={resolve('/auth/sign-in')}
							>Sign in to your library</a
						><button onclick={() => library?.sync()}>Try connecting again</button
						>{#if status && !status.online}<button
								onclick={() =>
									library?.openCached().catch((error: Error) => feedback(error.message))}
								>Open cached library on this trusted device</button
							>{/if}{/if}
				</section>
			{:else if view === 'tags'}
				<TagsExplorer
					bind:this={tagsExplorer}
					{tags}
					counts={shelfStats.counts}
					shelves={shelfStats.shelves}
					onSelect={(value) => void navigate(null, value)}
					onCreate={(name) => create('tag', name)}
				/>
			{:else}
				{#if !feedMode && view !== 'people'}<div class="list-toolbar">
						<button
							class="column-sort"
							onclick={() => (sort = sort === 'title' ? 'newest' : 'title')}
							aria-label="Sort by title">Title{sort === 'title' ? ' ↑' : ''}</button
						>
						{#if query}<span class="muted">{results.items.length} found</span>{/if}
						<button
							class="list-shortcuts"
							aria-label="Keyboard shortcuts"
							onclick={() => (helpOpen = true)}><kbd>?</kbd> shortcuts</button
						>
						<DropdownMenu.Root
							><DropdownMenu.Trigger class="column-sort date-sort" aria-label="Sort results"
								>{sort === 'recently_opened' ? 'Last opened' : 'Created at'}<ChevronDownIcon
								/></DropdownMenu.Trigger
							><DropdownMenu.Portal
								><DropdownMenu.Content class="menu-content" align="end" sideOffset={5}>
									{#each [{ value: 'newest', label: 'Newest first' }, { value: 'title', label: 'Title A–Z' }, { value: 'recently_opened', label: 'Recently opened' }] as option (option.value)}<DropdownMenu.Item
											class="menu-item"
											onSelect={() => (sort = option.value)}
											><span>{option.label}</span>{#if sort === option.value}<Check
													class="menu-check"
												/>{/if}</DropdownMenu.Item
										>{/each}
								</DropdownMenu.Content></DropdownMenu.Portal
							></DropdownMenu.Root
						>
					</div>{/if}

				{#if results.error}<p class="notice inset" role="alert">{results.error}</p>{/if}

				<div
					class="bookmark-list"
					class:post-feed={feedMode}
					class:people-list={view === 'people' && !feedMode}
					class:searching={!!query}
				>
					{#if profileSlug && !person}<p class="panel-message">
							This person is unavailable.
						</p>{:else}
						{#each results.items.slice(0, limit) as item (String(item.id))}
							{#if item.entityKind === 'person'}<PersonRow
									person={item}
									handle={handleOf(String(item.id))}
									photo={photoOf(String(item.id))}
									count={connections.get(String(item.id))?.size ?? 0}
									onOpen={() => navigate({ kind: 'person', id: String(item.id) })}
								/>
							{:else if feedMode}<PostCard
									{item}
									people={profileSlug ? [] : (peopleOnPost.get(String(item.id)) ?? [])}
									{feedback}
									note={notePreview(noteBodies.get(String(item.id)) ?? '')}
									onDisconnect={profileSlug && connectedIds.includes(String(item.id))
										? () =>
												void disconnectContent(String(item.id)).catch((e) => feedback(e.message))
										: undefined}
									selected={selected?.id === item.id}
									marked={markedSet.has(String(item.id))}
									onMove={() => openMove([String(item.id)])}
									onPerson={(id) => void navigate({ kind: 'person', id })}
									onEdit={() => void navigate({ kind: 'bookmark', id: String(item.id) })}
									onAction={(action) => void bookmarkAction(item, action)}
									onOpen={() => void library?.save({ type: 'activity.open', id: String(item.id) })}
								/>
							{:else}<BookmarkCard
									{item}
									{feedback}
									note={notePreview(noteBodies.get(String(item.id)) ?? '')}
									selected={selected?.id === item.id}
									marked={markedSet.has(String(item.id))}
									onMove={() => openMove([String(item.id)])}
									onEdit={() => void navigate({ kind: 'bookmark', id: String(item.id) })}
									onAction={(action) => void bookmarkAction(item, action)}
									onOpen={() => void library?.save({ type: 'activity.open', id: String(item.id) })}
								/>{/if}
						{:else}{#if !results.error}{@const peopleEmpty = !query && view === 'people'}
								<section class="welcome-panel compact">
									<h2>
										{query
											? 'Nothing matched this search.'
											: profileSlug
												? 'Nothing connected yet.'
												: peopleEmpty && feedMode && feedScope === 'all'
													? 'No posts saved yet.'
													: peopleEmpty && feedMode
														? people.length
															? 'No connected links yet.'
															: 'Keep people close to what they make.'
														: peopleEmpty
															? 'No people yet.'
															: 'No bookmarks here yet.'}
									</h2>
									<p>
										{query
											? 'Try a title, note, #tag or @username.'
											: profileSlug
												? 'Connect a saved link above, or tag them with @ while saving one.'
												: peopleEmpty && feedMode && feedScope === 'all'
													? 'Save a post from X and it shows up here, connected to someone or not.'
													: peopleEmpty
														? 'Add someone, then connect links to them. Everything they make collects on their page and here.'
														: 'Paste a link above to save your first bookmark.'}
									</p>
									{#if !query && view !== 'trash' && !profileSlug && !(peopleEmpty && feedMode && (people.length || feedScope === 'all'))}<button
											class="primary-button"
											onclick={() => create(view === 'people' ? 'person' : 'bookmark')}
											>{view === 'people' ? 'Add person' : 'Add bookmark'}</button
										>{/if}
								</section>{/if}{/each}{/if}
				</div>

				{#if results.items.length > limit}<button class="load-more" onclick={() => (limit += 100)}
						>Show more</button
					>{/if}
			{/if}
		</div>
	</main>
	{#if mobile && status?.ready}<MobileNavbar
			bind:searching={navSearching}
			{view}
			onSelect={(value) => {
				navSearching = false;
				void navigate(null, value);
			}}
			onAccount={() => (settings = true)}
			onSearch={() => void openOmnibar('search')}
			omnibar={omnibarSlot}
		/>{/if}
	<Toast {notice} hidden={settings} onDismiss={() => (notice = null)} />
</div>

<Dialog.Root
	open={!!selected}
	onOpenChange={(open) => {
		if (!open) void navigate(null);
	}}
>
	<Dialog.Portal
		><Dialog.Overlay class="dialog-overlay editor-overlay" /><Dialog.Content
			trapFocus={!wideEditor}
			preventScroll={!wideEditor}
			preventOverflowTextSelection={!wideEditor}
			onInteractOutside={(event) => {
				if (wideEditor) event.preventDefault();
			}}
			class="dialog-content editor-dialog"
			onCloseAutoFocus={(event) => {
				event.preventDefault();
				document
					.querySelector<HTMLElement>(`[data-bookmark-id="${editorReturnId}"] .bookmark-title`)
					?.focus();
			}}
		>
			{#snippet child({ props })}<div {...props} aria-modal={wideEditor ? undefined : true}>
					<Dialog.Title class="sr-only">Edit bookmark</Dialog.Title>
					<Dialog.Description class="sr-only"
						>Edit your bookmark, notes, tags, and connected people. Changes save automatically.</Dialog.Description
					>
					{#if library && selected}{#key selected.id}<LibraryInspector
								{library}
								entity={selected}
								{version}
								navigate={(target) => void navigate(target)}
								{feedback}
								close={() => void navigate(null)}
							/>{/key}{/if}
				</div>{/snippet}
		</Dialog.Content></Dialog.Portal
	>
</Dialog.Root>

<Dialog.Root bind:open={creating}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content
			class={['dialog-content', 'name-sheet', newType === 'person' && 'person-sheet']}
		>
			<header class="name-sheet-head">
				<Dialog.Title class="name-sheet-title"
					>{newType === 'person'
						? editingPerson
							? 'Edit person'
							: 'New person'
						: 'New tag'}</Dialog.Title
				>
				<Dialog.Close
					class="icon-button name-sheet-close"
					disabled={formBusy}
					aria-label="Close creation form"><XIcon /></Dialog.Close
				>
			</header>
			<Dialog.Description class="sr-only"
				>{newType === 'person'
					? 'A name, their links and a little context.'
					: 'Name a tag to group related links.'}</Dialog.Description
			>
			<form class="name-sheet-form" onsubmit={submitCreate}>
				<fieldset disabled={formBusy}>
					<label class="name-sheet-name">
						<span class="sr-only">Name</span>
						{#if newType === 'tag'}<span class="name-sheet-glyph" aria-hidden="true">#</span>{/if}
						<input
							id="capture-title"
							bind:value={newTitle}
							required
							maxlength={newType === 'person' ? 200 : 64}
							placeholder={newType === 'person' ? 'Full name' : 'tag-name'}
							autocomplete="off"
							spellcheck="false"
						/>
					</label>
					{#if newType === 'tag'}<p class={['name-sheet-hint', existingTag && 'exists']}>
							{#if existingTag}#{existingTag.name} already exists.
								<button
									type="button"
									class="text-button"
									onclick={() => {
										creating = false;
										void navigate(null, `tag:${existingTag?.id}`);
									}}>Open it</button
								>{:else}Shows in your sidebar. Add it to links from the editor or while saving with
								#name.{/if}
						</p>{:else}
						<div class="name-sheet-fields">
							<label class="name-sheet-field">
								<span>Links</span>
								<input
									id="person-url"
									bind:value={personUrl}
									placeholder="@username, site.com, github.com/name"
									autocomplete="off"
									autocapitalize="off"
									spellcheck="false"
									aria-describedby="person-url-hint"
								/>
							</label>
							<label class="name-sheet-field">
								<span>About</span>
								<textarea
									id="capture-note"
									bind:value={newNote}
									rows="2"
									placeholder="A little context"
									{@attach autosize(newNote)}></textarea>
							</label>
						</div>
						<p id="person-url-hint" class="name-sheet-hint">
							@ for an X username. Separate links with commas.
						</p>
					{/if}
					{#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
					<footer class="name-sheet-actions">
						<Dialog.Close class="name-sheet-cancel" type="button">Cancel</Dialog.Close>
						<button
							type="submit"
							class="name-sheet-submit"
							disabled={formBusy || !newTitle.trim() || !!existingTag}
							>{formBusy
								? 'Saving…'
								: editingPerson
									? 'Save'
									: newType === 'person'
										? 'Add person'
										: 'Create tag'}</button
						>
					</footer>
				</fieldset>
			</form>
		</Dialog.Content></Dialog.Portal
	></Dialog.Root
>
<AccountPanel
	bind:open={settings}
	{library}
	{status}
	{tags}
	{toast}
	{feedback}
	onCreate={create}
	onManage={openManage}
	onExport={exportData}
	onExportBrowser={exportBrowserData}
	onImport={pickImport}
	onExportPending={async () => {
		if (library) download(await library.exportPending(), 'prism-pending-work.json');
	}}
	onMaintenance={runMaintenance}
/>
<MovePalette
	bind:open={moveOpen}
	count={moving.length}
	{tags}
	sourceId={moveSource}
	onPick={(id) => void moveTo(id)}
	onCreate={(name) => void createAndMove(name)}
/>
<Dialog.Root bind:open={helpOpen}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content keyboard-dialog"
			><Dialog.Title class="dialog-title"><Keyboard /> Keyboard shortcuts</Dialog.Title
			><Dialog.Description class="dialog-description"
				>A little muscle memory goes a long way.</Dialog.Description
			><KeyboardHelp /><Dialog.Close
				class="icon-button dialog-close"
				aria-label="Close keyboard shortcuts"><XIcon /></Dialog.Close
			></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>
{#if browserPlan}{#key browserPlan}<BrowserImportDialog
			bind:open={browserImportOpen}
			plan={browserPlan}
			{library}
			online={!!status?.online}
			pending={status?.pending ?? 0}
			{feedback}
			{download}
		/>{/key}{/if}
<Dialog.Root bind:open={importOpen}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content v0-dialog"
			><Dialog.Title class="dialog-title">Import preview</Dialog.Title><Dialog.Description
				class="dialog-description"
				>Import copies metadata into new identities. Existing saved URLs and their notes are kept.
				This can take several separate saves.</Dialog.Description
			>{#if importPreview}<pre class="import-preview">{JSON.stringify(
						importPreview.counts,
						null,
						2
					)}</pre>
				{#each importPreview.errors as error (error)}<p class="form-error">
						{error}
					</p>{/each}{#each importPreview.warnings as warning (warning)}<p class="muted">
						{warning}
					</p>{/each}<button
					class="primary-button"
					onclick={runImport}
					disabled={importBusy ||
						!importPreview.valid ||
						!!importReport ||
						!status?.online ||
						!!status?.pending}>{importBusy ? 'Importing…' : 'Import copy'}</button
				>{/if}
			<p role="status">{importProgress}</p>
			{#if importReport}<p>
					{importReport.status === 'complete' ? 'Import finished.' : 'Import stopped.'}
					{importReport.blockedNotes.length} notes need review.
				</p>
				<button onclick={() => download(importReport, 'prism-import-report.json')}
					>Download report and recoverable notes</button
				>{#if importReport.error}<p class="form-error">
						{importReport.error}
					</p>{/if}{/if}<Dialog.Close
				class="icon-button dialog-close"
				aria-label="Close import"
				disabled={importBusy}><XIcon /></Dialog.Close
			></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>
<Dialog.Root
	open={!!manage}
	onOpenChange={(value) => {
		if (!value) manage = null;
	}}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content name-sheet"
			>{#if manage}{@const count = shelfStats.counts[String(manage.row.id)] ?? 0}
				<header class="name-sheet-head">
					<Dialog.Title class="name-sheet-title">Edit tag</Dialog.Title>
					<Dialog.Close class="icon-button name-sheet-close" aria-label="Close tag editor"
						><XIcon /></Dialog.Close
					>
				</header>
				<Dialog.Description class="sr-only"
					>Rename this tag, hide it from the public page, or delete it. Renaming keeps every
					connection.</Dialog.Description
				>
				<form
					class="name-sheet-form"
					onsubmit={(event) => {
						event.preventDefault();
						if (renamed) void manageSave();
					}}
				>
					<fieldset>
						<label class="name-sheet-name">
							<span class="sr-only">Name</span>
							<span class="name-sheet-glyph" aria-hidden="true">#</span>
							<input
								id="manage-name"
								bind:value={rename}
								maxlength="64"
								autocomplete="off"
								spellcheck="false"
							/>
						</label>
						<p class="name-sheet-hint">
							{count === 0
								? 'Not on any bookmarks yet.'
								: `On ${count} ${count === 1 ? 'bookmark' : 'bookmarks'}.`} Renaming keeps every connection.
						</p>
						<button
							type="button"
							class="name-sheet-privacy"
							role="switch"
							aria-checked={managedPrivate}
							disabled={privacyBusy}
							onclick={togglePrivacy}
							>{#if managedPrivate}<Lock />{:else}<Globe />{/if}<span
								class="name-sheet-privacy-text"
								><strong>Hide from public page</strong><small
									>{managedPrivate
										? 'Hidden, along with everything tagged with it.'
										: 'Shown on the public page.'}</small
								></span
							><span class="preference-switch" class:enabled={managedPrivate}><span></span></span
							></button
						>
						<footer class="name-sheet-actions">
							{#if deleteArmed}<span class="name-sheet-confirm"
									><span>Delete #{manage.row.name}?{count ? ' Bookmarks stay.' : ''}</span><button
										type="button"
										class="name-sheet-cancel"
										onclick={() => (deleteArmed = false)}>Keep</button
									><button
										type="button"
										class="name-sheet-danger"
										data-cuelume-warning
										onclick={() => manageSave(true)}>Delete</button
									></span
								>{:else}<button
									type="button"
									class="name-sheet-delete"
									onclick={() => (deleteArmed = true)}><Trash2 />Delete</button
								><button type="submit" class="name-sheet-submit" disabled={!renamed}>Rename</button
								>{/if}
						</footer>
					</fieldset>
				</form>
			{/if}</Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>
<AlertDialog.Root
	bind:open={purgeOpen}
	onOpenChange={(open) => {
		if (!open) purgeTarget = null;
	}}
>
	<AlertDialog.Portal
		><AlertDialog.Overlay class="dialog-overlay" /><AlertDialog.Content class="dialog-content"
			><AlertDialog.Title class="dialog-title">Delete bookmark permanently?</AlertDialog.Title
			><AlertDialog.Description class="dialog-description"
				>This removes the bookmark and its note. It cannot be undone.</AlertDialog.Description
			>
			<div class="button-row dialog-actions">
				<AlertDialog.Cancel class="secondary-button">Keep in trash</AlertDialog.Cancel
				><AlertDialog.Action class="danger-button" onclick={() => void purgeBookmark()}
					>Delete permanently</AlertDialog.Action
				>
			</div></AlertDialog.Content
		></AlertDialog.Portal
	></AlertDialog.Root
>
