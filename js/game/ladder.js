/**
 * What board a level number asks for.
 *
 * Levels are generated, so the ladder is the only thing that makes level 30
 * harder than level 3: it widens the board, adds blocks and walls, and raises
 * the number of taps the solution has to take. The generator draws boards until
 * one lands inside the window this returns.
 *
 * The ladder has no end. Everything grows to a ceiling and then holds, because
 * past that the board stops being readable on a phone and the search behind the
 * "no way out" warning stops being affordable.
 */

export const FIRST_LEVEL = 1;

/** Widest board the ladder will ask for. Nine columns is about 34 pt a cell on a phone. */
export const MAX_SIZE = 9;

/** Most blocks on one board. Past a dozen the search space stops being cheap to walk. */
export const MAX_BLOCKS = 11;

/**
 * The entry points the menu offers, as the level each one starts on.
 *
 * Three places to join the one ladder, not three settings. Medium opens where
 * the ladder starts demanding a shunt -- a tap that parks a block rather than
 * clearing it. Hard keeps the shunt and grows the board around it.
 */
export const DIFFICULTIES = [
	{ name: "Easy", from: 1 },
	{ name: "Medium", from: 10 },
	{ name: "Hard", from: 15 },
];

/**
 * Taps beyond one per block that the solution must take. Zero means every block
 * can be sent straight out in some order and the puzzle is only that order.
 *
 * One is the ceiling, and it is a fact about the puzzle rather than a choice.
 * A board that forces a second shunt has to hold two independent knots at once,
 * and those turn up perhaps once in a thousand boards -- rare enough that asking
 * for one costs more time than the board is worth. Boards that happen to need
 * two are still kept: the par window has room for them.
 */
function shuntsFor(level) {
	return level < DIFFICULTIES[1].from ? 0 : 1;
}

/**
 * The board to build for a level, as sizes and a par window.
 *
 * `minPar`/`maxPar` are the whole difficulty measure. Par is the shortest
 * solution the search can find, so a board that happens to fall apart in a few
 * taps is rejected however big it is.
 */
export function specFor(level) {
	const n = Math.max(FIRST_LEVEL, Math.round(Number(level) || FIRST_LEVEL));
	const size = Math.min(5 + Math.floor((n - 1) / 5), MAX_SIZE);
	const blocks = Math.min(3 + Math.floor((n - 1) / 2), MAX_BLOCKS);
	const walls = n < 5 ? 0 : Math.min(Math.floor((n - 4) / 4), 4);
	const shunts = shuntsFor(n);
	return {
		size,
		blocks,
		walls,
		shunts,
		minPar: blocks + shunts,
		// A ceiling as well as a floor: a board that needs twenty taps to unpick
		// is not the harder version of one that needs ten, it is a slog.
		maxPar: blocks + shunts + 5,
	};
}

/** Caption for the top bar: "Level 7  ·  6x6, 6 blocks". */
export function describe(level) {
	const spec = specFor(level);
	return `Level ${level}  ·  ${spec.size}×${spec.size}, ${spec.blocks} blocks`;
}
