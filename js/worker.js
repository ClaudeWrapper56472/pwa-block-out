/**
 * Level generation, off the main thread.
 *
 * Finding a board that needs a block shunted aside is a search, and it can take
 * a moment. Running it here keeps the main thread free to draw the "finding a
 * level" overlay and keeps the page responsive.
 *
 * The protocol is one request in, one reply out, tagged with the caller's id so
 * a reply that arrives after the player has moved on can be recognised and
 * dropped.
 */
import { buildLevel } from "./builder.js";

self.addEventListener("message", (event) => {
	const { id, level, seen } = event.data;
	try {
		self.postMessage({ id, spec: buildLevel(level, seen ?? []) });
	} catch (error) {
		self.postMessage({ id, spec: null, error: String(error) });
	}
});
