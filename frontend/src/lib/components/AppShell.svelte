<script lang="ts">
	import {
		Bookmark as BookmarkIcon,
		Circle as CircleIcon,
		Info as InfoIcon,
		LayoutGrid as LayoutGridIcon,
		Users as UsersIcon,
		Inbox as InboxIcon,
		X as XIcon
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { Dialog } from 'bits-ui';

	onMount(() => {
		const frame = requestAnimationFrame(() => {
			performance.mark('prism:shell-ready');
		});
		return () => cancelAnimationFrame(frame);
	});
</script>

<a class="skip-link" href="#main-content">Skip to content</a>

<div class="app-shell">
	<header class="app-header">
		<a class="brand" href={resolve('/')} aria-label="Prism home">
			<span class="brand-symbol" aria-hidden="true">P</span>
		</a>
		<a class="foundation-badge" href={resolve('/auth/sign-in')}>Account</a>
		<Dialog.Root>
			<Dialog.Trigger class="icon-button" aria-label="About this foundation">
				<InfoIcon />
			</Dialog.Trigger>
			<Dialog.Portal>
				<Dialog.Overlay class="dialog-overlay" />
				<Dialog.Content class="dialog-content">
					<Dialog.Title class="dialog-title">A foundation for your knowledge</Dialog.Title>
					<Dialog.Description class="dialog-description">
						The workspace is ready. Saving content, people profiles and synchronization will be
						added in the next milestones. No account or service connection is required for this
						shell.
					</Dialog.Description>
					<Dialog.Close class="icon-button dialog-close" aria-label="Close about dialog">
						<XIcon />
					</Dialog.Close>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	</header>

	<div class="workspace">
		<nav class="sidebar" aria-label="Library navigation">
			<p class="section-label">Library</p>
			<a href={resolve('/')} aria-current="page" class="nav-item active">
				<InboxIcon /> <span>Inbox</span>
			</a>
			<button class="nav-item" disabled title="Available in a later milestone">
				<BookmarkIcon /> <span>All content</span>
			</button>
			<button class="nav-item" disabled title="Available in a later milestone">
				<UsersIcon /> <span>People</span>
			</button>
			<button class="nav-item" disabled title="Available in a later milestone">
				<LayoutGridIcon /> <span>Personas</span>
			</button>
			<p class="navigation-note">More views will become available as your library takes shape.</p>
		</nav>

		<main id="main-content" tabindex="-1">
			<div class="pane-header">
				<h1>Inbox</h1>
				<span class="subtle-label">Your starting point</span>
			</div>
			<section class="empty-state" aria-labelledby="empty-heading">
				<div class="empty-icon"><BookmarkIcon /></div>
				<p class="eyebrow">A little space for everything you learn</p>
				<h2 id="empty-heading">Your library starts here</h2>
				<p>
					A home for the things you want to remember.<br class="desktop-break" />
					Saved content, people and connections will come together here.
				</p>
				<span class="empty-note">Capture and search are coming in the next milestones.</span>
			</section>
		</main>

		<aside class="inspector" aria-labelledby="inspector-heading">
			<div class="pane-header"><h2 id="inspector-heading">Inspector</h2></div>
			<div class="inspector-empty">
				<BookmarkIcon />
				<p>A closer look</p>
				<span>Notes, people and backlinks will appear here when you select an item.</span>
			</div>
		</aside>
	</div>

	<footer class="status-bar">
		<span class="connection-state"><CircleIcon /> Not connected</span>
		<span>Personal knowledge, connected.</span>
	</footer>
</div>
