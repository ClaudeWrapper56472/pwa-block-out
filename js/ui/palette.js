import { COLOURS } from "../game/level.js";

/**
 * The colour a block is painted.
 *
 * Every colour value lives in the stylesheet. What is here is the part it cannot
 * say: a block's colour comes from the level rather than from a class, so it has
 * to be set per element. Pointing --block at the same --colour-* property the
 * gates use is what stops a block and the gate it leaves by from drifting apart.
 */

/** Used only if a level somehow carries a colour the stylesheet has no name for. */
const FALLBACK = "#8b93a3";

export function paintBlock(element, code) {
	const name = COLOURS[code] ?? "none";
	element.style.setProperty("--block", `var(--colour-${name}, ${FALLBACK})`);
}
