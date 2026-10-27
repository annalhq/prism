<script lang="ts">
	import { X as XIcon } from '@lucide/svelte';
	import { cubicOut } from 'svelte/easing';
	export type Notice = { id: number; message: string };
	let {
		notice,
		hidden = false,
		onDismiss
	}: { notice: Notice | null; hidden?: boolean; onDismiss: () => void } = $props();
	// Long enough to read, never long enough to linger: ~2.4s plus reading time, capped at 6s.
	const lifetime = (message: string) => Math.min(6000, 2400 + message.length * 40);
	let timer: ReturnType<typeof setTimeout> | undefined,
		remaining = 0,
		startedAt = 0,
		held = false;
	function run(ms: number) {
		clearTimeout(timer);
		remaining = ms;
		startedAt = performance.now();
		timer = setTimeout(onDismiss, ms);
	}
	// Hovering or focusing the toast pauses its clock; leaving resumes what was left.
	function hold(next: boolean) {
		if (!notice || held === next) return;
		held = next;
		if (next) {
			clearTimeout(timer);
			remaining = Math.max(0, remaining - (performance.now() - startedAt));
		} else run(Math.max(remaining, 1200));
	}
	$effect(() => {
		if (!notice) return;
		held = false;
		run(lifetime(notice.message));
		return () => clearTimeout(timer);
	});
	function rise(_node: Element, { duration = 260 }: { duration?: number } = {}) {
		return {
			duration,
			easing: cubicOut,
			css: (t: number, u: number) =>
				`opacity: ${t}; transform: translateY(${u * 14}px) scale(${0.94 + 0.06 * t}); filter: blur(${u * 2}px)`
		};
	}
	function sink(_node: Element, { duration = 180 }: { duration?: number } = {}) {
		return {
			duration,
			easing: cubicOut,
			css: (t: number, u: number) =>
				`opacity: ${t}; transform: translateY(${u * 6}px) scale(${1 - 0.04 * u})`
		};
	}
</script>

<div
	class="toast-region"
	class:toast-hidden={hidden}
	role="status"
	aria-live="polite"
	onpointerenter={() => hold(true)}
	onpointerleave={() => hold(false)}
	onfocusin={() => hold(true)}
	onfocusout={() => hold(false)}
>
	{#if notice}{#key notice.id}<div class="action-toast" in:rise out:sink>
				<span>{notice.message}</span><button
					class="toast-dismiss"
					aria-label="Dismiss message"
					onclick={onDismiss}><XIcon /></button
				>
			</div>{/key}{/if}
</div>
