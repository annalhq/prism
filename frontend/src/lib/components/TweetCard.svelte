<script lang="ts" module>
	import type { TweetCardData } from '#lib/domain/tweet-card.js';
	// Shared across cards and mounts: a post fetched once is ready the next time it scrolls by.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- A plain request cache; nothing renders from it.
	const requests = new Map<string, Promise<TweetCardData | null>>();
	function load(id: string): Promise<TweetCardData | null> {
		let request = requests.get(id);
		if (!request) {
			request = fetch(`/api/v1/tweets/${id}`, { headers: { accept: 'application/json' } })
				.then((response) => (response.ok ? (response.json() as Promise<TweetCardData>) : null))
				.catch(() => {
					requests.delete(id);
					return null;
				});
			requests.set(id, request);
		}
		return request;
	}
</script>

<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- Every link here is an https URL on x.com or one the post itself links to. */
	import type { Snippet } from 'svelte';
	import { BadgeCheck, Play } from '@lucide/svelte';
	import type { TweetMediaItem, TweetSegment } from '#lib/domain/tweet-card.js';
	let {
		id,
		onOpen,
		fallback
	}: {
		id: string;
		onOpen: () => void;
		// What to show when the post can't be loaded: deleted, private, offline or signed out.
		fallback: Snippet;
	} = $props();
	let element = $state<HTMLElement>();
	let phase = $state<'idle' | 'loading' | 'ready' | 'missing'>('idle');
	let tweet = $state<TweetCardData | null>(null);
	let playing = $state<number | null>(null);
	// Load only as the card nears the viewport, so a long feed doesn't ask X for every post.
	$effect(() => {
		if (!element || phase !== 'idle') return;
		const current = id;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry.isIntersecting) return;
				observer.disconnect();
				phase = 'loading';
				void load(current).then((value) => {
					if (current !== id) return;
					tweet = value;
					phase = value ? 'ready' : 'missing';
				});
			},
			{ rootMargin: '480px 0px' }
		);
		observer.observe(element);
		return () => observer.disconnect();
	});
	const ratio = (item: TweetMediaItem) =>
		item.width && item.height ? `${item.width} / ${item.height}` : '16 / 9';
</script>

{#snippet text(
	segments: TweetSegment[]
)}{#each segments as segment, index (index)}{#if segment.type === 'text'}{segment.text}{:else}<a
				href={segment.href}
				target="_blank"
				rel="noopener noreferrer">{segment.text}</a
			>{/if}{/each}{/snippet}

{#snippet media(items: TweetMediaItem[], interactive: boolean)}
	{#if items.length}<div class="tweet-media" data-count={items.length}>
			{#each items as item, index (index)}<figure
					class="tweet-media-item"
					style:aspect-ratio={items.length === 1 ? ratio(item) : undefined}
				>
					{#if item.video && (item.kind === 'gif' || (interactive && playing === index))}<video
							src={item.video}
							poster={item.image}
							autoplay
							playsinline
							muted={item.kind === 'gif'}
							loop={item.kind === 'gif'}
							controls={item.kind === 'video'}
							preload="none"
						></video>{:else}<img
							src={item.image}
							alt={item.alt}
							loading="lazy"
							decoding="async"
							referrerpolicy="no-referrer"
						/>{#if item.kind === 'video' && interactive}<button
								class="tweet-play"
								aria-label="Play video"
								onclick={() => (playing = index)}><Play /></button
							>{/if}{/if}
				</figure>{/each}
		</div>{/if}
{/snippet}

<div class="tweet-slot" bind:this={element}>
	{#if phase === 'ready' && tweet}<article class="tweet-card">
			<!-- The head is the post's link, and the row the list keyboard moves to. -->
			<a
				class="tweet-head bookmark-title"
				href={tweet.url}
				target="_blank"
				rel="noopener noreferrer"
				onclick={onOpen}
			>
				<img
					class="tweet-avatar"
					src={tweet.author.avatar}
					alt=""
					width="28"
					height="28"
					loading="lazy"
					referrerpolicy="no-referrer"
				/>
				<span class="tweet-who"
					><strong
						>{tweet.author.name}{#if tweet.author.verified}<BadgeCheck
								class="tweet-verified"
								aria-label="Verified"
							/>{/if}</strong
					><span>@{tweet.author.handle}</span></span
				>
				<svg class="tweet-x" viewBox="0 0 24 24" aria-hidden="true"
					><path
						d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
					/></svg
				>
			</a>
			{#if tweet.replyTo}<p class="tweet-reply">Replying to @{tweet.replyTo}</p>{/if}
			{#if tweet.segments.length}<p class="tweet-text">{@render text(tweet.segments)}</p>{/if}
			{@render media(tweet.media, true)}
			{#if tweet.quoted}<a
					class="tweet-quote"
					href={tweet.quoted.url}
					target="_blank"
					rel="noopener noreferrer"
				>
					<span class="tweet-who"
						><img
							class="tweet-avatar small"
							src={tweet.quoted.author.avatar}
							alt=""
							width="18"
							height="18"
							loading="lazy"
							referrerpolicy="no-referrer"
						/><strong>{tweet.quoted.author.name}</strong><span>@{tweet.quoted.author.handle}</span
						></span
					>
					{#if tweet.quoted.segments.length}<span class="tweet-text"
							>{#each tweet.quoted.segments as segment, index (index)}{segment.text}{/each}</span
						>{/if}
					{@render media(tweet.quoted.media.slice(0, 1), false)}
				</a>{/if}
		</article>{:else if phase === 'missing'}{@render fallback()}{:else}<div
			class="tweet-skeleton"
			aria-busy="true"
			aria-label="Loading post"
		>
			<span class="tweet-skeleton-head"><i></i><b></b></span>
			<span class="tweet-skeleton-line"></span>
			<span class="tweet-skeleton-line short"></span>
		</div>{/if}
</div>
