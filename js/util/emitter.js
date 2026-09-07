/**
 * A named-event emitter.
 *
 * Every part of the app talks through this: the board view listens for moves and
 * animates them, the game screen listens for counters and repaints labels. No
 * view reaches into another view's DOM, and input travels back up as events, so
 * a view can be driven by a different controller without changing it.
 */
export class Emitter {
	#listeners = new Map();

	/** Returns a function that removes the listener again. */
	on(name, handler) {
		let handlers = this.#listeners.get(name);
		if (handlers === undefined) {
			handlers = new Set();
			this.#listeners.set(name, handlers);
		}
		handlers.add(handler);
		return () => handlers.delete(handler);
	}

	off(name, handler) {
		this.#listeners.get(name)?.delete(handler);
	}

	emit(name, ...args) {
		const handlers = this.#listeners.get(name);
		if (handlers === undefined) return;
		// Copied so a handler may unsubscribe itself mid-emit.
		for (const handler of [...handlers]) handler(...args);
	}
}
