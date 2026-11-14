<script lang="ts">
	import { Folder, FolderOpen } from '@lucide/svelte';
	// Both states are drawn and cross-faded, so opening reads as the flap lifting, not a swap.
	let { open = false }: { open?: boolean } = $props();
</script>

<span class={['folder-glyph', open && 'open']} aria-hidden="true"
	><Folder class="folder-glyph-shut" /><FolderOpen class="folder-glyph-open" /></span
>
