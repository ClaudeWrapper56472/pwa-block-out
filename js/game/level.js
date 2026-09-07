/**
 * One level, and the picture format it is written in.
 *
 * A level is authored as a block of text with a frame around it. The frame is
 * the board edge: a colour letter there is a gate of that colour, a dot is solid
 * edge. Inside the frame a capital letter is a cell of the block with that id,
 * `#` is a wall and a dot is empty floor.
 *
 *     ....rr..        two red gate cells on the top edge
 *     .AA..#..        block A, two cells wide, and a wall
 *     b..CC...        a blue gate on the left edge
 *     ........
 *
 * Each block id also needs a colour and a facing, given as `"r>"` in the spec's
 * `blocks` table: colour code then one of `^ > v <`.
 *
 * Nothing here changes during play. Positions live in BoardState, as offsets
 * from the cells parsed here.
 */

export const Dir = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };

/** Row and column delta for each direction, indexed by Dir. */
export const STEP = [
	{ dr: -1, dc: 0 },
	{ dr: 0, dc: 1 },
	{ dr: 1, dc: 0 },
	{ dr: 0, dc: -1 },
];

export const ARROWS = { "^": Dir.UP, ">": Dir.RIGHT, v: Dir.DOWN, "<": Dir.LEFT };

/** Colour code -> the name used for the CSS custom property and for messages. */
export const COLOURS = {
	r: "red",
	b: "blue",
	g: "green",
	y: "yellow",
	p: "purple",
	o: "orange",
	t: "teal",
	k: "pink",
};

const WALL = "#";
const EMPTY = ".";

export class Level {
	constructor(number, spec) {
		this.number = number;
		this.name = String(spec.name ?? `Level ${number}`);
		/** Fewest taps that clear the board. Asserted against the solver in tests. */
		this.par = Number(spec.par ?? 0);

		const art = readArt(spec.art, number);
		this.rows = art.length - 2;
		this.cols = art[0].length - 2;
		this.walls = new Uint8Array(this.rows * this.cols);
		/** gates[dir][lane] is a colour code, or "" for solid edge. */
		this.gates = [
			new Array(this.cols).fill(""),
			new Array(this.rows).fill(""),
			new Array(this.cols).fill(""),
			new Array(this.rows).fill(""),
		];
		this.blocks = [];

		this._readEdges(art);
		this._readInterior(art, spec.blocks ?? {});
	}

	index(row, col) {
		return row * this.cols + col;
	}

	inside(row, col) {
		return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
	}

	isWall(row, col) {
		return this.walls[this.index(row, col)] === 1;
	}

	/** The colour code of the gate a block leaving through `dir` in `lane` meets. */
	gateAt(dir, lane) {
		return this.gates[dir][lane] ?? "";
	}

	blockCount() {
		return this.blocks.length;
	}

	_readEdges(art) {
		const last = art.length - 1;
		for (let col = 0; col < this.cols; col += 1) {
			this.gates[Dir.UP][col] = gateCode(art[0][col + 1], this.number);
			this.gates[Dir.DOWN][col] = gateCode(art[last][col + 1], this.number);
		}
		for (let row = 0; row < this.rows; row += 1) {
			const line = art[row + 1];
			this.gates[Dir.LEFT][row] = gateCode(line[0], this.number);
			this.gates[Dir.RIGHT][row] = gateCode(line[line.length - 1], this.number);
		}
	}

	_readInterior(art, table) {
		const cellsById = new Map();
		for (let row = 0; row < this.rows; row += 1) {
			for (let col = 0; col < this.cols; col += 1) {
				const char = art[row + 1][col + 1];
				if (char === EMPTY) continue;
				if (char === WALL) {
					this.walls[this.index(row, col)] = 1;
					continue;
				}
				if (char < "A" || char > "Z") {
					throw new Error(`Level ${this.number}: "${char}" is not a block id, a wall or empty floor.`);
				}
				if (!cellsById.has(char)) cellsById.set(char, []);
				cellsById.get(char).push({ row, col });
			}
		}

		// Sorted so a level's blocks are in reading order whatever order the ids
		// happen to appear in, which keeps saved move lists stable.
		for (const id of [...cellsById.keys()].sort()) {
			const cells = cellsById.get(id);
			const spec = String(table[id] ?? "");
			const code = spec.replace(/\s+/g, "");
			const colour = code[0] ?? "";
			const arrow = code[1] ?? "";
			if (!(colour in COLOURS)) {
				throw new Error(`Level ${this.number}: block ${id} has no colour (got "${spec}").`);
			}
			if (!(arrow in ARROWS)) {
				throw new Error(`Level ${this.number}: block ${id} has no facing (got "${spec}").`);
			}
			if (!isConnected(cells)) {
				throw new Error(`Level ${this.number}: block ${id} is split into separate pieces.`);
			}
			this.blocks.push({ id, colour, dir: ARROWS[arrow], cells });
		}

		for (const id of Object.keys(table)) {
			if (!cellsById.has(id)) {
				throw new Error(`Level ${this.number}: block ${id} is listed but never drawn.`);
			}
		}
		if (this.blocks.length === 0) {
			throw new Error(`Level ${this.number}: no blocks to clear.`);
		}
	}
}

export function buildLevels(specs) {
	return specs.map((spec, index) => new Level(index + 1, spec));
}

function readArt(art, number) {
	if (!Array.isArray(art) || art.length < 3) {
		throw new Error(`Level ${number}: the picture needs a frame and at least one row.`);
	}
	const width = art[0].length;
	for (const line of art) {
		if (typeof line !== "string" || line.length !== width) {
			throw new Error(`Level ${number}: every line must be ${width} characters wide.`);
		}
	}
	if (width < 3) throw new Error(`Level ${number}: the picture needs a frame and at least one column.`);
	return art;
}

function gateCode(char, number) {
	if (char === EMPTY) return "";
	if (char in COLOURS) return char;
	throw new Error(`Level ${number}: "${char}" on the edge is neither a gate colour nor solid edge.`);
}

/** Blocks must be one piece: a split block would slide as two and look wrong. */
function isConnected(cells) {
	const key = ({ row, col }) => `${row},${col}`;
	const remaining = new Map(cells.map((cell) => [key(cell), cell]));
	const queue = [cells[0]];
	remaining.delete(key(cells[0]));
	while (queue.length > 0) {
		const { row, col } = queue.pop();
		for (const { dr, dc } of STEP) {
			const neighbour = remaining.get(`${row + dr},${col + dc}`);
			if (neighbour === undefined) continue;
			remaining.delete(`${row + dr},${col + dc}`);
			queue.push(neighbour);
		}
	}
	return remaining.size === 0;
}
