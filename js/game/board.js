import { STEP, Dir } from "./level.js";

/** Grid values that are not a block index. */
const EMPTY = -1;
const WALL = -2;

/**
 * Where every block is right now, and the rules for moving one.
 *
 * A tap slides a block as far as it can go in the direction it faces. If the
 * whole block can leave the board through gates of its own colour it escapes;
 * otherwise it stops against whatever is in the way and stays there. That second
 * half is what makes the order of taps matter: a block parked in the wrong lane
 * is in someone else's way until you undo it.
 *
 * Positions are offsets from the cells the level was drawn with, so a whole
 * board state is a short list of number pairs -- cheap to hash for the solver in
 * the tests, and cheap to write to the save.
 *
 * No DOM here. The view animates what these methods report.
 */
export class BoardState {
	constructor(level) {
		this.level = level;
		this.offsets = level.blocks.map(() => ({ dr: 0, dc: 0 }));
		this.removed = level.blocks.map(() => false);
		this._grid = new Int16Array(level.rows * level.cols);
		this._paint();
	}

	/** The cells block `index` covers now. */
	cellsOf(index) {
		const { dr, dc } = this.offsets[index];
		return this.level.blocks[index].cells.map((cell) => ({
			row: cell.row + dr,
			col: cell.col + dc,
		}));
	}

	occupantAt(row, col) {
		if (!this.level.inside(row, col)) return WALL;
		return this._grid[this.level.index(row, col)];
	}

	remaining() {
		return this.removed.reduce((count, gone) => count + (gone ? 0 : 1), 0);
	}

	isCleared() {
		return this.remaining() === 0;
	}

	/** Blocks that would go somewhere if tapped. Empty means the board is stuck. */
	movable() {
		const list = [];
		for (let index = 0; index < this.removed.length; index += 1) {
			if (this.removed[index]) continue;
			if (this.canExit(index) || this.maxSlide(index) > 0) list.push(index);
		}
		return list;
	}

	/**
	 * How many cells the block can travel before something stops it. The board
	 * edge stops it too, which is why escaping is a separate question.
	 */
	maxSlide(index) {
		if (this.removed[index]) return 0;
		const { dr, dc } = STEP[this.level.blocks[index].dir];
		const cells = this.cellsOf(index);
		const limit = this.level.rows + this.level.cols;
		let steps = 0;
		while (steps < limit) {
			const next = steps + 1;
			for (const cell of cells) {
				const row = cell.row + dr * next;
				const col = cell.col + dc * next;
				if (!this.level.inside(row, col)) return steps;
				const occupant = this._grid[this.level.index(row, col)];
				if (occupant !== EMPTY && occupant !== index) return steps;
			}
			steps = next;
		}
		return steps;
	}

	/**
	 * Whether the block can leave the board: every cell has a clear run to the
	 * edge, and every lane it leaves through is a gate of its own colour.
	 *
	 * Checked per cell rather than by sliding, so an L-shaped block with one arm
	 * boxed in cannot slip out on the strength of the other.
	 */
	canExit(index) {
		if (this.removed[index]) return false;
		const block = this.level.blocks[index];
		const { dr, dc } = STEP[block.dir];
		const lanes = new Set();
		for (const cell of this.cellsOf(index)) {
			let row = cell.row + dr;
			let col = cell.col + dc;
			while (this.level.inside(row, col)) {
				const occupant = this._grid[this.level.index(row, col)];
				if (occupant !== EMPTY && occupant !== index) return false;
				row += dr;
				col += dc;
			}
			lanes.add(block.dir === Dir.UP || block.dir === Dir.DOWN ? cell.col : cell.row);
		}
		for (const lane of lanes) {
			if (this.level.gateAt(block.dir, lane) !== block.colour) return false;
		}
		return true;
	}

	/**
	 * Taps block `index`. Returns what happened; `blocked` moves leave the board
	 * exactly as it was and do not belong on the undo stack.
	 */
	tap(index) {
		if (index < 0 || index >= this.removed.length || this.removed[index]) return null;
		const escaped = this.canExit(index);
		const steps = this.maxSlide(index);
		if (!escaped && steps === 0) return { index, steps: 0, escaped: false, blocked: true };

		const { dr, dc } = STEP[this.level.blocks[index].dir];
		const move = { index, steps, escaped, blocked: false, dr: dr * steps, dc: dc * steps };
		this._erase(index);
		this.offsets[index] = {
			dr: this.offsets[index].dr + move.dr,
			dc: this.offsets[index].dc + move.dc,
		};
		if (escaped) this.removed[index] = true;
		else this._draw(index);
		return move;
	}

	/** Puts a move back. The exact mirror of the second half of tap(). */
	revert(move) {
		if (move === null || move.blocked) return;
		const index = move.index;
		if (!this.removed[index]) this._erase(index);
		this.removed[index] = false;
		this.offsets[index] = {
			dr: this.offsets[index].dr - move.dr,
			dc: this.offsets[index].dc - move.dc,
		};
		this._draw(index);
	}

	/** A short string that is equal for equal positions. Used to hash the search. */
	key() {
		const parts = [];
		for (let index = 0; index < this.removed.length; index += 1) {
			const { dr, dc } = this.offsets[index];
			parts.push(this.removed[index] ? "x" : `${dr}.${dc}`);
		}
		return parts.join("|");
	}

	snapshot() {
		return {
			offsets: this.offsets.map((offset) => ({ ...offset })),
			removed: [...this.removed],
		};
	}

	restore(snapshot) {
		this.offsets = snapshot.offsets.map((offset) => ({ ...offset }));
		this.removed = [...snapshot.removed];
		this._paint();
	}

	clone() {
		const copy = new BoardState(this.level);
		copy.offsets = this.offsets.map((offset) => ({ ...offset }));
		copy.removed = [...this.removed];
		copy._paint();
		return copy;
	}

	reset() {
		this.offsets = this.level.blocks.map(() => ({ dr: 0, dc: 0 }));
		this.removed = this.level.blocks.map(() => false);
		this._paint();
	}

	_paint() {
		this._grid.fill(EMPTY);
		for (let cell = 0; cell < this._grid.length; cell += 1) {
			if (this.level.walls[cell] === 1) this._grid[cell] = WALL;
		}
		for (let index = 0; index < this.removed.length; index += 1) {
			if (!this.removed[index]) this._draw(index);
		}
	}

	_draw(index) {
		for (const cell of this.cellsOf(index)) {
			this._grid[this.level.index(cell.row, cell.col)] = index;
		}
	}

	_erase(index) {
		for (const cell of this.cellsOf(index)) {
			this._grid[this.level.index(cell.row, cell.col)] = EMPTY;
		}
	}
}
