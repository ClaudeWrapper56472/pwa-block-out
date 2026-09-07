import { BoardState } from "./board.js";

/**
 * Breadth-first search over board positions.
 *
 * Sliding a block that cannot escape changes the board, so positions form a
 * graph rather than a chain and a level really can be played into a corner. The
 * search answers both questions that matter: is this position still winnable,
 * and what is the shortest way home.
 *
 * Breadth-first because the shortest answer is the level's par, and the tests
 * assert every level's declared par against it.
 *
 * `budget` caps how many positions are visited. Running out returns "unknown"
 * rather than a guess -- the game only tells a player they are stuck when the
 * whole reachable space has been searched and none of it wins.
 */
export function search(state, budget = 200000) {
	const scratch = state.clone();
	const start = state.key();
	const seen = new Map([[start, { snapshot: state.snapshot(), from: null, move: -1 }]]);
	let frontier = [start];
	let visited = 1;

	if (state.isCleared()) return { status: "solved", moves: [], visited };

	while (frontier.length > 0) {
		const next = [];
		for (const key of frontier) {
			scratch.restore(seen.get(key).snapshot);
			for (const index of scratch.movable()) {
				scratch.restore(seen.get(key).snapshot);
				scratch.tap(index);
				const childKey = scratch.key();
				if (seen.has(childKey)) continue;
				const entry = { snapshot: scratch.snapshot(), from: key, move: index };
				seen.set(childKey, entry);
				visited += 1;
				if (scratch.isCleared()) {
					return { status: "solved", moves: pathTo(seen, childKey), visited };
				}
				if (visited >= budget) return { status: "unknown", moves: [], visited };
				next.push(childKey);
			}
		}
		frontier = next;
	}
	return { status: "unsolvable", moves: [], visited };
}

/** True only when the search proved there is no way to clear the board. */
export function isDeadEnd(state, budget = 60000) {
	return search(state, budget).status === "unsolvable";
}

/** Shortest number of taps that clears a fresh level, or -1 if it cannot be done. */
export function par(level, budget = 200000) {
	const result = search(new BoardState(level), budget);
	return result.status === "solved" ? result.moves.length : -1;
}

function pathTo(seen, key) {
	const moves = [];
	let cursor = key;
	while (cursor !== null) {
		const entry = seen.get(cursor);
		if (entry.from === null) break;
		moves.push(entry.move);
		cursor = entry.from;
	}
	return moves.reverse();
}
