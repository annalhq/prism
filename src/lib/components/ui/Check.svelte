<script lang="ts">
	import { Check as CheckIcon } from '@lucide/svelte';
	import { Checkbox } from 'bits-ui';
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
	{#if checked}<CheckIcon />{/if}
</Checkbox.Root>
