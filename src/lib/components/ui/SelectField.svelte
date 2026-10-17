<script lang="ts">
	import { ChevronDown as ChevronDownIcon, Check as CheckIcon } from '@lucide/svelte';
	import { Select } from 'bits-ui';
	let {
		value = $bindable(''),
		options,
		label,
		id,
		disabled = false,
		name,
		required = false,
		onValueChange
	}: {
		value?: string;
		options: { value: string; label: string; disabled?: boolean }[];
		label: string;
		id?: string;
		disabled?: boolean;
		name?: string;
		required?: boolean;
		onValueChange?: (value: string) => void;
	} = $props();
</script>

<Select.Root
	type="single"
	bind:value
	{disabled}
	{name}
	{required}
	items={options}
	allowDeselect={false}
	{onValueChange}
>
	<Select.Trigger {id} aria-label={label} class="select-trigger">
		<span>{options.find((option) => option.value === value)?.label ?? label}</span><ChevronDownIcon
		/>
	</Select.Trigger>
	<Select.Portal
		><Select.Content class="select-content" sideOffset={6}>
			<Select.Viewport>
				{#each options as option (option.value)}
					<Select.Item
						value={option.value}
						label={option.label}
						disabled={option.disabled}
						class="select-item"
					>
						<span>{option.label}</span>{#if value === option.value}<CheckIcon />{/if}
					</Select.Item>
				{/each}
			</Select.Viewport>
		</Select.Content></Select.Portal
	>
</Select.Root>
