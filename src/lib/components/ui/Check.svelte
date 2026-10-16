<script lang="ts">
	import { Checkbox } from 'bits-ui';
	import IconCheckFill from 'phosphor-icons-svelte/IconCheckFill.svelte';
	let {
		checked = $bindable(false),
		label,
		id,
		disabled = false,
		onCheckedChange
	}: {
		checked?: boolean;
		label: string;
		id?: string;
		disabled?: boolean;
		onCheckedChange?: (checked: boolean) => void;
	} = $props();
</script>

<Checkbox.Root
	{id}
	class="ui-checkbox"
	bind:checked
	{disabled}
	aria-label={label}
	{onCheckedChange}
>
	{#if checked}<IconCheckFill />{/if}
</Checkbox.Root>
