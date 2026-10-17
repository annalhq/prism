<script lang="ts">
	const groups = [
		{
			title: 'Move around',
			rows: [
				['j / k', 'Next / previous bookmark'],
				['gg / G', 'First / last visible bookmark'],
				['Ctrl d / Ctrl u', 'Half a page down / up'],
				['f', 'Find a view, tag or collection']
			]
		},
		{
			title: 'Capture & search',
			rows: [
				['i', 'Insert a link'],
				['/ · Ctrl / ⌘ F', 'Search the library'],
				['Esc', 'Return to normal mode'],
				['Enter', 'Continue, choose, or save']
			]
		},
		{
			title: 'Focused bookmark',
			rows: [
				['o / Enter', 'Open the link'],
				['e / Space', 'Edit bookmark'],
				['y', 'Copy the link'],
				['x', 'Select / deselect']
			]
		},
		{
			title: 'Workspace',
			rows: [
				[',', 'Account & settings'],
				['?', 'Keyboard shortcuts']
			]
		}
	];
</script>

<div class="shortcut-guide">
	<p class="muted">
		Vim keys work in normal mode. Typing in a field stays yours. Use Escape to leave the omnibar.
	</p>
	{#each groups as group (group.title)}<section>
			<h3>{group.title}</h3>
			<dl>
				{#each group.rows as [keys, description] (keys)}<div>
						<dt>{description}</dt>
						<dd><kbd>{keys}</kbd></dd>
					</div>{/each}
			</dl>
		</section>{/each}
</div>
