/** Hands the browser a file to save, built from text already in memory. */
export function downloadFile(content: string, name: string, type: string) {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}
