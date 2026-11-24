<script lang="ts">
	import FolderGlyph from '../../ui/FolderGlyph.svelte';
	import FolderMenu from '../../FolderMenu.svelte';
	import { tagsPageFolders as folderState, type FolderGroup } from '#lib/client/folders.svelte.js';
	import MobileTagRow from './MobileTagRow.svelte';

	type Row = Record<string, unknown>;
	// One space's folders, each folding its tags beneath it, then its loose tags. Shares the
	// tags page's global classes and fold state, so folders stay open or shut across both.
	let {
		groups,
		loose,
		counts,
		onSelect,
		onCreate,
		onEditFolder
	}: {
		groups: FolderGroup[];
		loose: Row[];
		counts: Record<string, number>;
		onSelect: (value: string) => void;
		onCreate?: (name: string) => void;
		// Long-press a folder for its sheet (rename, choose tags, delete).
		onEditFolder?: (folder: Row, intent?: 'delete') => void;
	} = $props();
	// Rows rise in one after another, briefly; past the first few they arrive together.
	const stagger = (index: number) => Math.min(index, 8);
</script>

{#if groups.length}<div class="tag-folders">
		{#each groups as group, index (String(group.folder.id))}
			{@const id = String(group.folder.id)}
			{@const open = folderState.isOpen(id)}
			<section class={['tag-folder', open && 'open']} style:--i={stagger(index)}>
				{#snippet head()}<button
						class="tag-folder-toggle"
						aria-expanded={open}
						onclick={() => folderState.setOpen(id, !open)}
						><FolderGlyph {open} /><span>{group.folder.name}</span><small
							>{group.tags.length} {group.tags.length === 1 ? 'tag' : 'tags'}</small
						></button
					>{/snippet}
				{#if onEditFolder}<FolderMenu
						folder={group.folder}
						onEdit={onEditFolder}
						onCreateIn={onCreate && ((folder) => onCreate(`${folder.name}/`))}
						class="tag-folder-head">{@render head()}</FolderMenu
					>{:else}<div class="tag-folder-head">{@render head()}</div>{/if}
				<div class="tag-folder-body" data-open={open} inert={!open}>
					<div>
						{#if group.tags.length}<ul class="tag-list">
								{#each group.tags as row (String(row.id))}<li>
										<MobileTagRow tag={row} count={counts[String(row.id)] ?? 0} {onSelect} />
									</li>{/each}
							</ul>{:else}<p class="tags-empty tag-folder-empty">
								{onEditFolder ? 'Empty. Press and hold the folder to choose its tags.' : 'Empty.'}
							</p>{/if}
					</div>
				</div>
			</section>
		{/each}
	</div>{/if}
{#if loose.length}<ul class="tag-list">
		{#each loose as row, index (String(row.id))}<li style:--i={stagger(groups.length + index)}>
				<MobileTagRow tag={row} count={counts[String(row.id)] ?? 0} {onSelect} />
			</li>{/each}
	</ul>{/if}

<style>
	.tag-folder {
		animation: rise-in 320ms var(--ease-out) both;
		animation-delay: calc(var(--i, 0) * 15ms);
	}
	.tag-list li {
		animation-delay: calc(var(--i, 0) * 15ms);
	}
	.tag-folders :global(.tag-folder-head) {
		-webkit-touch-callout: none;
		user-select: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.tag-folder {
			animation: none;
		}
	}
</style>
