import { renderCaptureForm } from '../capture-form';
import type { Capture } from '../protocol';
import { ease } from './layout';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The in-page capture popover. Only one can be open at a time, so every layout
 * shares the `capturePanel` instance below.
 */
class CapturePanel {
	#host: HTMLElement | undefined;
	#anchor: HTMLElement | undefined;
	#resizeObserver: ResizeObserver | undefined;

	close = () => {
		const host = this.#host;
		host?.shadowRoot?.dispatchEvent(new CustomEvent('prism-dispose'));
		this.#host = undefined;
		this.#anchor = undefined;
		this.#resizeObserver?.disconnect();
		this.#resizeObserver = undefined;
		document.removeEventListener('pointerdown', this.#onOutsideClick, true);
		document.removeEventListener('keydown', this.#onEscape, true);
		window.removeEventListener('scroll', this.#place, true);
		window.removeEventListener('resize', this.#place);
		if (!host) return;
		host.style.pointerEvents = 'none';
		const exit = host.animate(
			reducedMotion()
				? [{ opacity: 1 }, { opacity: 0 }]
				: [
						{ opacity: 1, transform: 'none' },
						{ opacity: 0, transform: 'translateY(2px) scale(0.98)' }
					],
			{ duration: 140, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }
		);
		exit.finished.then(
			() => host.remove(),
			() => host.remove()
		);
	};

	async open(anchor: HTMLElement, capture: Capture, onSaved: () => void) {
		this.close();
		const light = matchMedia('(prefers-color-scheme: light)').matches;
		const host = document.createElement('div');
		host.dataset.prismPopover = 'true';
		host.style.cssText = `position:fixed;z-index:2147483647;max-height:calc(100vh - 20px);overflow:auto;border-radius:14px;transform-origin:top right;filter:${
			light
				? 'drop-shadow(0 10px 24px rgb(38 37 30 / 12%)) drop-shadow(0 1px 3px rgb(38 37 30 / 8%))'
				: 'drop-shadow(0 14px 32px rgb(0 0 0 / 45%)) drop-shadow(0 1px 3px rgb(0 0 0 / 30%))'
		}`;
		const shadow = host.attachShadow({ mode: 'open' });
		// Keep the page's keyboard shortcuts from reacting to typing inside the panel.
		for (const type of ['keydown', 'keyup', 'keypress'])
			host.addEventListener(type, (event) => event.stopPropagation());
		document.body.append(host);
		this.#host = host;
		this.#anchor = anchor;
		this.#place();
		host.animate(
			reducedMotion()
				? [{ opacity: 0 }, { opacity: 1 }]
				: [
						{ opacity: 0, transform: 'translateY(4px) scale(0.98)' },
						{ opacity: 1, transform: 'none' }
					],
			{ duration: 200, easing: ease }
		);
		shadow.addEventListener('prism-close', this.close);
		shadow.addEventListener('prism-saved', onSaved);
		document.addEventListener('pointerdown', this.#onOutsideClick, true);
		document.addEventListener('keydown', this.#onEscape, true);
		window.addEventListener('scroll', this.#place, true);
		window.addEventListener('resize', this.#place);
		this.#resizeObserver = new ResizeObserver(() => this.#place());
		this.#resizeObserver.observe(host);
		try {
			await renderCaptureForm(shadow, capture, this.close, true);
			this.#place();
		} catch (error) {
			const status = document.createElement('p');
			status.textContent = (error as Error).message;
			status.style.cssText = `margin:0;padding:14px 16px;border:1px solid ${light ? '#26251e1a' : '#303030'};border-radius:14px;background:${light ? '#fbfbf9' : '#1a1a1a'};color:${light ? '#cf2d56' : '#f2a6a0'};font:13px/1.45 system-ui,sans-serif`;
			shadow.append(status);
		}
	}

	#onOutsideClick = (event: PointerEvent) => {
		if (this.#host && event.target instanceof Node && !this.#host.contains(event.target))
			this.close();
	};

	#onEscape = (event: KeyboardEvent) => {
		if (event.key !== 'Escape' || !this.#host) return;
		// Inside the panel, the form decides: the first Escape clears token text, the next closes.
		if (event.composedPath().includes(this.#host)) return;
		this.close();
	};

	#place = () => {
		const host = this.#host;
		if (!host || !this.#anchor) return;
		const rect = this.#anchor.getBoundingClientRect();
		const width = Math.min(360, window.innerWidth - 20);
		const height = host.getBoundingClientRect().height;
		host.style.width = `${width}px`;
		host.style.left = `${Math.max(10, Math.min(rect.right - width, window.innerWidth - width - 10))}px`;
		host.style.top = `${Math.max(10, Math.min(rect.bottom + 8, window.innerHeight - height - 10))}px`;
	};
}

export const capturePanel = new CapturePanel();
