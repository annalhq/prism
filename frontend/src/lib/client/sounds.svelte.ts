import { bind, play, setEnabled, setTheme, setVolume, unlock, type SoundName } from 'cuelume';
export const soundPreference = $state({ enabled: true });
let lastCue = 0;
export function setSounds(enabled: boolean) {
	soundPreference.enabled = enabled;
	setEnabled(enabled);
	try {
		localStorage.setItem('prism:sounds', String(enabled));
	} catch {
		/* Device storage is optional. */
	}
}
export function cue(name: SoundName) {
	if (typeof window === 'undefined' || !soundPreference.enabled) return;
	const now = performance.now();
	if (now - lastCue < 180 && name !== 'error') return;
	lastCue = now;
	play(name, { theme: 'press', emphasis: 'subtle', volume: 0.3 });
}
export function foregroundSound() {
	const timer = setTimeout(() => cue('loading'), 800);
	return () => clearTimeout(timer);
}
export function initializeSounds() {
	try {
		soundPreference.enabled = localStorage.getItem('prism:sounds') !== 'false';
	} catch {
		/* Use default. */
	}
	setEnabled(soundPreference.enabled);
	setTheme('press');
	setVolume(0.3);
	document.documentElement.dataset.cuelumeTheme = 'press';
	document.documentElement.dataset.cuelumeEmphasis = 'subtle';
	const activate = () => {
		void unlock();
	};
	document.addEventListener('pointerdown', activate, { passive: true });
	document.addEventListener('keydown', activate);
	const cleanup = bind();
	return () => {
		cleanup();
		document.removeEventListener('pointerdown', activate);
		document.removeEventListener('keydown', activate);
	};
}
