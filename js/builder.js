import { generate } from "./game/generator.js";

/**
 * Builds the board for a level number. Every board is drawn fresh, so no two
 * players and no two runs get the same one.
 *
 * Reads nothing but its arguments, which is what lets the worker run it. `seen`
 * arrives as a plain array because a Set does not survive postMessage in every
 * browser.
 *
 * The result is a level spec -- the same picture format a level would have been
 * written in by hand -- which is a plain object, so it crosses the worker
 * boundary and goes into the save document as it is.
 */
export function buildLevel(number, seenList) {
	return generate(number, 0, undefined, new Set(seenList.map(Number)));
}
