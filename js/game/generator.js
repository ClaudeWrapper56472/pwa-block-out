import { Level, Dir, STEP, COLOURS } from "./level.js";
import { BoardState } from "./board.js";
import { search } from "./solver.js";
import * as Ladder from "./ladder.js";
import { Rng } from "../util/rng.js";

/**
 * Builds a level for a level number.
 *
 * The board is drawn first and coloured afterwards. Blocks are scattered at
 * random -- shape, square and facing -- and only then is each one asked which
 * lanes it would leave through, so those lanes can be painted its colour. Every
 * block therefore has a gate it could reach, and the only thing standing between
 * it and the edge is the other blocks.
 *
 * Doing it the other way round is the trap. Placing each block somewhere it can
 * already leave from guarantees a solution, but it guarantees a worthless one:
 * undo the placements in reverse and the board empties a block at a time, so the
 * puzzle is only ever the order, never a block that has to be moved aside first.
 * That order survives everything added afterwards, so no amount of shuffling
 * rescues it.
 *
 * Scattering gives up the guarantee, and plenty of boards come out jammed --
 * two blocks facing each other with nowhere to go. That is what the search is
 * for. A board is kept only if it solves, and only if the shortest solution
 * lands inside the level's par window. That number is the whole difficulty
 * measure: par above one tap per block means some block has to be shunted out of
 * the way before it can leave.
 */

export const DEFAULT_MAX_ATTEMPTS = 400;

/** Positions the check may visit. A board too tangled to verify is not shipped. */
export const VERIFY_BUDGET = 150000;

const EMPTY = -1;
const WALL = -2;

/**
 * Block shapes, as cell offsets. Weighted by how often they appear in the list:
 * single squares read most clearly and slide most predictably, so there are more
 * of them, and the shapes that turn a corner are what let two blocks stand in
 * each other's way.
 */
const SHAPES = [
	[{ dr: 0, dc: 0 }],
	[{ dr: 0, dc: 0 }],
	[{ dr: 0, dc: 0 }],
	[{ dr: 0, dc: 0 }, { dr: 0, dc: 1 }],
	[{ dr: 0, dc: 0 }, { dr: 1, dc: 0 }],
	[{ dr: 0, dc: 0 }, { dr: 0, dc: 1 }, { dr: 0, dc: 2 }],
	[{ dr: 0, dc: 0 }, { dr: 1, dc: 0 }, { dr: 2, dc: 0 }],
	[{ dr: 0, dc: 0 }, { dr: 1, dc: 0 }, { dr: 1, dc: 1 }],
	[{ dr: 0, dc: 1 }, { dr: 1, dc: 0 }, { dr: 1, dc: 1 }],
	[{ dr: 0, dc: 0 }, { dr: 0, dc: 1 }, { dr: 1, dc: 0 }],
	[{ dr: 0, dc: 0 }, { dr: 0, dc: 1 }, { dr: 1, dc: 1 }],
];

/**
 * The board under construction: walls, gates, and where the blocks sit.
 *
 * Deliberately not a BoardState. That class needs a finished Level to exist, and
 * this one is grown a block at a time with no colours on it yet. The two agree
 * on the rules that matter -- maxSlide and canExit are the same walk -- and the
 * tests check a generated board against the real thing.
 */
class Canvas {
	constructor(rows, cols) {
		this.rows = rows;
		this.cols = cols;
		this.grid = new Int16Array(rows * cols).fill(EMPTY);
		this.gates = [
			new Array(cols).fill(""),
			new Array(rows).fill(""),
			new Array(cols).fill(""),
			new Array(rows).fill(""),
		];
		this.blocks = [];
	}

	index(row, col) {
		return row * this.cols + col;
	}

	inside(row, col) {
		return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
	}

	at(row, col) {
		return this.inside(row, col) ? this.grid[this.index(row, col)] : WALL;
	}

	setWall(row, col) {
		this.grid[this.index(row, col)] = WALL;
	}

	add(block) {
		this.blocks.push(block);
		for (const cell of block.cells) {
			this.grid[this.index(cell.row, cell.col)] = this.blocks.length - 1;
		}
	}

	erase(index) {
		for (const cell of this.blocks[index].cells) {
			this.grid[this.index(cell.row, cell.col)] = EMPTY;
		}
	}

	clone() {
		const copy = new Canvas(this.rows, this.cols);
		copy.grid.set(this.grid);
		copy.gates = this.gates.map((edge) => [...edge]);
		copy.blocks = this.blocks.map((block) => ({ ...block, cells: block.cells.map((cell) => ({ ...cell })) }));
		copy.palette = this.palette;
		return copy;
	}

	/** The lanes a block leaving through `dir` would pass through. */
	lanesOf(cells, dir) {
		const vertical = dir === Dir.UP || dir === Dir.DOWN;
		return [...new Set(cells.map((cell) => (vertical ? cell.col : cell.row)))];
	}

	canExit(index) {
		const block = this.blocks[index];
		const { dr, dc } = STEP[block.dir];
		for (const cell of block.cells) {
			let row = cell.row + dr;
			let col = cell.col + dc;
			while (this.inside(row, col)) {
				const at = this.grid[this.index(row, col)];
				if (at !== EMPTY && at !== index) return false;
				row += dr;
				col += dc;
			}
		}
		return this.lanesOf(block.cells, block.dir)
			.every((lane) => this.gates[block.dir][lane] === block.colour);
	}

	/**
	 * Whether the board falls apart by exits alone: take out whatever can leave,
	 * repeat, and see if anything is left.
	 *
	 * Removing a block only ever clears a path, and gates never move, so nothing
	 * that could leave stops being able to. The order is therefore irrelevant and
	 * one pass to fixpoint settles it -- which makes this the cheap way to ask the
	 * question that decides difficulty: does this board need a block moved aside?
	 */
	clearsWithoutShunts() {
		const saved = this.grid.slice();
		const removed = new Array(this.blocks.length).fill(false);
		let left = this.blocks.length;
		let progress = true;
		while (progress && left > 0) {
			progress = false;
			for (let index = 0; index < this.blocks.length; index += 1) {
				if (removed[index] || !this.canExit(index)) continue;
				this.erase(index);
				removed[index] = true;
				left -= 1;
				progress = true;
			}
		}
		this.grid.set(saved);
		return left === 0;
	}
}

/**
 * Draws a level, or null if nothing usable turned up.
 *
 * Reads nothing but its arguments, so it runs in a worker. `seen` is a set of
 * fingerprints to avoid, so a player is not handed the same board twice.
 */
export function generate(level, seed = 0, maxAttempts = DEFAULT_MAX_ATTEMPTS, seen = new Set()) {
	const wanted = Ladder.specFor(level);
	const actualSeed = seed !== 0 ? seed : Rng.randomSeed();
	const rng = new Rng(actualSeed);

	// The nearest miss, kept in case nothing lands inside the window. A board a
	// tap too easy is a far better answer than no board at all.
	let nearest = null;
	let nearestGap = Infinity;
	// A board that fits but has been served before. Worth less than a fresh one
	// and more than a miss.
	let repeat = null;

	// Tied once and grown from many times. Finding one costs more than every
	// other part of generation put together, and one knot makes as many different
	// boards as there are ways to grow around it.
	const knot = wanted.shunts > 0 ? tieKnot(rng, wanted) : null;

	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const canvas = attemptOne(rng, wanted, knot);
		if (canvas === null) continue;

		const draft = toSpec(canvas, actualSeed);
		const built = new Level(level, draft);
		// A board where half the blocks can already leave is a tidying job rather
		// than a puzzle, whatever its par turns out to be. Cheap, so it goes first.
		if (openings(built) > maxOpenings(wanted)) continue;

		if (canvas.clearsWithoutShunts()) {
			// One tap a block clears it, so the shortest solution is exactly one tap
			// per block and there is nothing for the search to find out.
			draft.par = canvas.blocks.length;
		} else {
			const result = search(new BoardState(built), VERIFY_BUDGET);
			if (result.status !== "solved") continue;
			draft.par = result.moves.length;
		}

		const gap = draft.par < wanted.minPar
			? wanted.minPar - draft.par
			: Math.max(draft.par - wanted.maxPar, 0);
		if (gap > 0) {
			if (gap < nearestGap) {
				nearest = draft;
				nearestGap = gap;
			}
			continue;
		}
		if (seen.has(draft.fingerprint)) {
			repeat = repeat ?? draft;
			continue;
		}
		return draft;
	}
	return repeat ?? nearest;
}

/**
 * One board: a knot to build around, then blocks added until the ladder has its
 * count. Null when it filled up first.
 *
 * Every added block goes somewhere it could leave from as the board stands, so
 * the additions peel straight back off again and what is left underneath is the
 * knot. That is what keeps the difficulty where it was put.
 */
function attemptOne(rng, wanted, knot) {
	const canvas = knot === null ? bareBoard(rng, wanted) : knot.clone();
	while (canvas.blocks.length < wanted.blocks) {
		if (!unExit(canvas, rng, canvas.palette)) return null;
	}
	return canvas;
}

function bareBoard(rng, wanted) {
	const canvas = new Canvas(wanted.size, wanted.size);
	placeWalls(canvas, rng, wanted.walls);
	canvas.palette = rng.shuffle(Object.keys(COLOURS)).slice(0, colourBudget(wanted));
	return canvas;
}

/** Blocks in a knot, and how many boards are looked at to find one. */
const KNOT_BLOCKS = 5;
const KNOT_SPAN = 4;
const KNOT_SAMPLES = 6000;
const KNOT_BUDGET = 20000;

/**
 * Finds a knot: a few blocks that cannot empty by exits alone, and can still be
 * solved.
 *
 * This is the only part of the puzzle that cannot be built to order. A board
 * grown by putting each block where it can already leave from always comes apart
 * one block at a time, so the puzzle is only ever the order -- there is never a
 * block that has to be shunted aside first. Boards like that have to be found,
 * not made: scatter a handful of blocks, colour the gates to match wherever they
 * landed, and look at what turned up.
 *
 * Most of what turns up is jammed rather than knotted -- blocks facing each
 * other with nowhere to go, which is a board with no answer at all. Roughly one
 * board in a thousand is stuck and still solvable, so this is a search, and it
 * is why the result is kept and grown from rather than thrown away.
 */
function tieKnot(rng, wanted) {
	const count = Math.min(KNOT_BLOCKS, wanted.blocks);
	const span = Math.min(KNOT_SPAN, wanted.size);
	for (let sample = 0; sample < KNOT_SAMPLES; sample += 1) {
		const canvas = bareBoard(rng, wanted);
		// Kept to a corner of the board rather than spread over it. Blocks only
		// knot with what they are next to, and on an open board they are next to
		// nothing -- everything has a clear run to its gate and simply leaves.
		const region = {
			row: rng.randiRange(0, wanted.size - span),
			col: rng.randiRange(0, wanted.size - span),
			size: span,
		};
		if (!scatter(canvas, rng, count, region)) continue;
		paint(canvas, rng, canvas.palette);
		if (canvas.clearsWithoutShunts()) continue;
		const level = new Level(1, toSpec(canvas, 0));
		if (search(new BoardState(level), KNOT_BUDGET).status !== "solved") continue;
		return canvas;
	}
	return null;
}

/**
 * Fewer colours means more blocks sharing a gate, which is easier. Enough of
 * them that a gate is a real constraint, not so many that the board turns into
 * a colour chart.
 */
function colourBudget(wanted) {
	return Math.min(Math.max(3, Math.ceil(wanted.blocks / 2)), Object.keys(COLOURS).length);
}

/** How many blocks could leave on the first tap. */
function openings(level) {
	const state = new BoardState(level);
	let count = 0;
	for (let index = 0; index < level.blocks.length; index += 1) {
		if (state.canExit(index)) count += 1;
	}
	return count;
}

function maxOpenings(wanted) {
	return Math.max(1, Math.ceil(wanted.blocks / 3));
}

/** Walls go down before any block, so nothing has to be moved out of their way. */
function placeWalls(canvas, rng, count) {
	for (let placed = 0; placed < count; placed += 1) {
		const row = rng.randiRange(0, canvas.rows - 1);
		const col = rng.randiRange(0, canvas.cols - 1);
		if (canvas.at(row, col) !== EMPTY) continue;
		canvas.setWall(row, col);
	}
}

/**
 * Drops blocks on the board at random, inside `region` if one is given. False
 * when they would not all fit.
 */
function scatter(canvas, rng, count, region = null) {
	const limit = count * 60;
	const focus = region === null ? null : {
		row: region.row + (region.size - 1) / 2,
		col: region.col + (region.size - 1) / 2,
	};
	for (let attempt = 0; attempt < limit && canvas.blocks.length < count; attempt += 1) {
		const shape = rng.pick(SHAPES);
		const anchor = rng.pick(anchorsFor(canvas, shape, region));
		if (anchor === undefined) continue;
		const cells = shape.map((offset) => ({
			row: anchor.row + offset.dr,
			col: anchor.col + offset.dc,
		}));
		if (!cells.every((cell) => canvas.at(cell.row, cell.col) === EMPTY)) continue;
		canvas.add({ cells, colour: "", dir: facing(cells, focus, rng) });
	}
	return canvas.blocks.length === count;
}

/**
 * Which way a block points. Random, unless it belongs to a knot, in which case
 * it mostly points inward.
 *
 * A block pointing off an empty board has a clear run to its gate and leaves on
 * the first tap, which is the opposite of a knot. Turning them to face each other
 * is what makes one likely enough to find.
 */
function facing(cells, focus, rng) {
	if (focus === null || rng.chance(25)) return rng.randiRange(0, 3);
	const row = cells.reduce((sum, cell) => sum + cell.row, 0) / cells.length;
	const col = cells.reduce((sum, cell) => sum + cell.col, 0) / cells.length;
	const inward = [];
	if (focus.row < row) inward.push(Dir.UP);
	if (focus.row > row) inward.push(Dir.DOWN);
	if (focus.col > col) inward.push(Dir.RIGHT);
	if (focus.col < col) inward.push(Dir.LEFT);
	return rng.pick(inward) ?? rng.randiRange(0, 3);
}

/**
 * Colours the blocks, and cuts each one a gate in the lanes it faces.
 *
 * Two blocks pointing at the same stretch of edge have to agree on its colour,
 * and a block spanning two lanes ties those two lanes together. So the lanes are
 * grouped first and a colour is handed to each group -- which is why colour is
 * decided here and not when a block is placed.
 *
 * Every block ends up with a gate it could leave by. Nothing is made easier by
 * that: a gate only ever opens the edge to a block already standing in front of
 * it, and what keeps a block standing there is the rest of the board.
 */
function paint(canvas, rng, palette) {
	const parent = new Map();
	const find = (key) => {
		while (parent.get(key) !== key) {
			parent.set(key, parent.get(parent.get(key)));
			key = parent.get(key);
		}
		return key;
	};
	const keysOf = (block) => canvas.lanesOf(block.cells, block.dir)
		.map((lane) => `${block.dir}:${lane}`);

	for (const block of canvas.blocks) {
		const keys = keysOf(block);
		for (const key of keys) if (!parent.has(key)) parent.set(key, key);
		for (const key of keys.slice(1)) parent.set(find(key), find(keys[0]));
	}

	const byGroup = new Map();
	for (const block of canvas.blocks) {
		const group = find(keysOf(block)[0]);
		if (!byGroup.has(group)) byGroup.set(group, palette[byGroup.size % palette.length]);
		block.colour = byGroup.get(group);
	}
	for (const block of canvas.blocks) {
		for (const lane of canvas.lanesOf(block.cells, block.dir)) {
			canvas.gates[block.dir][lane] = block.colour;
		}
	}
}

/**
 * Adds a block on a square it could leave from, painting the gates it leaves
 * through. False when there is nowhere left to put one.
 *
 * Of the squares that would do, the one taken is the one that gets in the most
 * blocks' way. A board where every block has a clear run to its gate is a board
 * that plays itself, whatever is knotted underneath it.
 */
function unExit(canvas, rng, palette) {
	const candidates = [];
	for (const dir of rng.shuffle([Dir.UP, Dir.RIGHT, Dir.DOWN, Dir.LEFT])) {
		for (const shape of rng.shuffle([...SHAPES])) {
			for (const anchor of rng.shuffle(anchorsFor(canvas, shape))) {
				const cells = shape.map((offset) => ({
					row: anchor.row + offset.dr,
					col: anchor.col + offset.dc,
				}));
				if (!cells.every((cell) => canvas.at(cell.row, cell.col) === EMPTY)) continue;
				if (!runsClear(canvas, cells, dir)) continue;
				const lanes = canvas.lanesOf(cells, dir);
				const colour = colourForGates(canvas, dir, lanes, rng, palette);
				if (colour === null) continue;
				candidates.push({ cells, dir, lanes, colour });
				if (candidates.length >= PLACEMENT_SAMPLE) break;
			}
			if (candidates.length >= PLACEMENT_SAMPLE) break;
		}
		if (candidates.length >= PLACEMENT_SAMPLE) break;
	}
	if (candidates.length === 0) return false;

	const free = countExits(canvas);
	let best = null;
	let bestBlocked = -1;
	for (const candidate of candidates) {
		place(canvas, candidate);
		// The new block can always leave, so it counts itself. What matters is how
		// many of the others it shuts in.
		const blocked = free - (countExits(canvas) - 1);
		unplace(canvas, candidate);
		if (blocked > bestBlocked) {
			bestBlocked = blocked;
			best = candidate;
		}
	}
	place(canvas, best);
	return true;
}

/** How many candidate squares are looked at before one is chosen. */
const PLACEMENT_SAMPLE = 40;

/** Every cell has a clear run to the edge. `cells` need not be on the board yet. */
function runsClear(canvas, cells, dir) {
	const { dr, dc } = STEP[dir];
	const own = new Set(cells.map((cell) => canvas.index(cell.row, cell.col)));
	for (const cell of cells) {
		let row = cell.row + dr;
		let col = cell.col + dc;
		while (canvas.inside(row, col)) {
			const key = canvas.index(row, col);
			if (canvas.grid[key] !== EMPTY && !own.has(key)) return false;
			row += dr;
			col += dc;
		}
	}
	return true;
}

/**
 * The colour a block leaving through these lanes must be. Lanes already gated
 * have to agree; free lanes are painted whatever colour is chosen for them.
 */
function colourForGates(canvas, dir, lanes, rng, palette) {
	let fixed = null;
	for (const lane of lanes) {
		const gate = canvas.gates[dir][lane];
		if (gate === "") continue;
		if (fixed !== null && fixed !== gate) return null;
		fixed = gate;
	}
	if (fixed !== null) return fixed;
	// The least-used colour, so the board does not end up a single hue. A gate is
	// painted the colour of whatever block first leaves through it, so picking at
	// random snowballs: one colour takes an edge, and every later block in those
	// lanes has to match it.
	const counts = new Map(palette.map((colour) => [colour, 0]));
	for (const block of canvas.blocks) {
		counts.set(block.colour, (counts.get(block.colour) ?? 0) + 1);
	}
	const fewest = Math.min(...palette.map((colour) => counts.get(colour) ?? 0));
	return rng.pick(palette.filter((colour) => (counts.get(colour) ?? 0) === fewest)) ?? null;
}

function place(canvas, candidate) {
	candidate.painted = candidate.lanes.map((lane) => canvas.gates[candidate.dir][lane]);
	for (const lane of candidate.lanes) canvas.gates[candidate.dir][lane] = candidate.colour;
	canvas.add({ cells: candidate.cells, colour: candidate.colour, dir: candidate.dir });
}

/**
 * Takes the last placement back, gates included. A lane the candidate did not
 * paint -- one that already carried its colour -- has to come back carrying it,
 * so what is put back is what was read, not blank edge.
 */
function unplace(canvas, candidate) {
	canvas.erase(canvas.blocks.length - 1);
	canvas.blocks.pop();
	for (const [at, lane] of candidate.lanes.entries()) {
		canvas.gates[candidate.dir][lane] = candidate.painted[at];
	}
}

function countExits(canvas) {
	let count = 0;
	for (let index = 0; index < canvas.blocks.length; index += 1) {
		if (canvas.canExit(index)) count += 1;
	}
	return count;
}

function anchorsFor(canvas, shape, region = null) {
	const height = Math.max(...shape.map((offset) => offset.dr)) + 1;
	const width = Math.max(...shape.map((offset) => offset.dc)) + 1;
	const fromRow = region?.row ?? 0;
	const fromCol = region?.col ?? 0;
	const toRow = Math.min(region === null ? canvas.rows : region.row + region.size, canvas.rows);
	const toCol = Math.min(region === null ? canvas.cols : region.col + region.size, canvas.cols);
	const anchors = [];
	for (let row = fromRow; row + height <= toRow; row += 1) {
		for (let col = fromCol; col + width <= toCol; col += 1) anchors.push({ row, col });
	}
	return anchors;
}

/** The finished board as a level spec: the same picture format a level is written in. */
function toSpec(canvas, seed) {
	const top = [];
	const bottom = [];
	for (let col = 0; col < canvas.cols; col += 1) {
		top.push(canvas.gates[Dir.UP][col] || ".");
		bottom.push(canvas.gates[Dir.DOWN][col] || ".");
	}

	const art = [`.${top.join("")}.`];
	for (let row = 0; row < canvas.rows; row += 1) {
		const line = [];
		for (let col = 0; col < canvas.cols; col += 1) {
			const at = canvas.at(row, col);
			if (at === WALL) line.push("#");
			else if (at === EMPTY) line.push(".");
			else line.push(letterFor(at));
		}
		art.push(
			(canvas.gates[Dir.LEFT][row] || ".") + line.join("") + (canvas.gates[Dir.RIGHT][row] || "."),
		);
	}
	art.push(`.${bottom.join("")}.`);

	const blocks = {};
	for (const [index, block] of canvas.blocks.entries()) {
		blocks[letterFor(index)] = block.colour + "^>v<"[block.dir];
	}
	return { par: 0, seed, blocks, art, fingerprint: fingerprintOf(art, blocks) };
}

function letterFor(index) {
	return String.fromCharCode(65 + index);
}

/**
 * Stable identity for a board, so one already played is not served again.
 *
 * Hashed rather than stored whole: a few hundred pictures would bloat the save
 * for nothing, and a collision costs exactly one skipped board.
 */
export function fingerprintOf(art, blocks) {
	const text = `${art.join("/")}|${Object.entries(blocks).map(([id, code]) => id + code).join("")}`;
	let hash = 0x811c9dc5;
	for (let at = 0; at < text.length; at += 1) {
		hash ^= text.charCodeAt(at);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}
