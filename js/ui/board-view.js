import { Dir, STEP, COLOURS } from "../game/level.js";
import { paintBlock } from "./palette.js";
import { Emitter } from "../util/emitter.js";

const DIRECTION_NAMES = ["up", "right", "down", "left"];

/**
 * Draws the board and animates what the game reports.
 *
 * The view holds no game state. It is told a level loaded and rebuilds; it is
 * told a block moved and slides it. Taps go back up as events, so the same view
 * could sit in front of a replay or a tutorial.
 *
 * Blocks are buttons, which is what they behave like: one press, one move. That
 * also hands us keyboard access, focus rings and the click timing the platform
 * thinks is right, none of which a div would have.
 *
 * Every static measurement is a calc() off `--step`, so a resize sets one number
 * rather than relaying out each tile. Only the sliding translate is written in
 * pixels, because a transition has to see a real length change to run.
 *
 * Emits: blockTapped(index)
 */
export class BoardView extends Emitter {
	static MS_PER_CELL = 55;
	static MIN_MS = 110;
	static MAX_MS = 280;
	/** The extra travel that carries an escaping block out through its gate. */
	static EXIT_CELLS = 1.6;

	constructor(root, game) {
		super();
		this.root = root;
		this.game = game;
		this._blocks = [];
		this._gates = [];
		this._step = 0;
		this._frame = 0;
		this._reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

		this._board = document.createElement("div");
		this._board.className = "board";
		this._gateLayer = document.createElement("div");
		this._gateLayer.className = "gates";
		this._well = document.createElement("div");
		this._well.className = "well";
		this._grid = document.createElement("div");
		this._grid.className = "grid";
		this._blockLayer = document.createElement("div");
		this._blockLayer.className = "blocks";
		this._well.append(this._grid, this._blockLayer);
		this._board.append(this._gateLayer, this._well);
		this.root.append(this._board);

		this._blockLayer.addEventListener("click", (event) => {
			const element = event.target.closest(".block");
			if (element === null) return;
			this.emit("blockTapped", Number(element.dataset.index));
		});

		new ResizeObserver(() => this._layout()).observe(this.root);

		game.on("levelLoaded", () => this._rebuild());
		game.on("moveApplied", (move) => this._animate(move, false));
		game.on("moveUndone", (move) => this._animate(move, true));
		game.on("moveBlocked", (index) => this._shake(index));
	}

	_rebuild() {
		const level = this.game.level;
		this._board.style.setProperty("--cols", String(level.cols));
		this._board.style.setProperty("--rows", String(level.rows));

		this._grid.replaceChildren();
		for (let row = 0; row < level.rows; row += 1) {
			for (let col = 0; col < level.cols; col += 1) {
				const cell = document.createElement("div");
				cell.className = level.isWall(row, col) ? "cell is-wall" : "cell";
				this._grid.append(cell);
			}
		}

		this._gateLayer.replaceChildren();
		this._gates = [];
		for (const run of gateRuns(level)) {
			const gate = document.createElement("div");
			gate.className = `gate side-${DIRECTION_NAMES[run.dir]}`;
			gate.style.setProperty("--gate", `var(--colour-${COLOURS[run.colour]})`);
			this._gateLayer.append(gate);
			this._gates.push({ element: gate, run });
		}

		this._blockLayer.replaceChildren();
		this._blocks = level.blocks.map((block, index) => this._buildBlock(block, index));
		this._blockLayer.append(...this._blocks);
		this._layout();
	}

	_buildBlock(block, index) {
		const element = document.createElement("button");
		element.type = "button";
		element.className = "block";
		element.dataset.index = String(index);
		paintBlock(element, block.colour);

		const rows = block.cells.map((cell) => cell.row);
		const cols = block.cells.map((cell) => cell.col);
		const top = Math.min(...rows);
		const left = Math.min(...cols);
		element.style.setProperty("--row", String(top));
		element.style.setProperty("--col", String(left));
		element.style.setProperty("--w", String(Math.max(...cols) - left + 1));
		element.style.setProperty("--h", String(Math.max(...rows) - top + 1));

		const filled = new Set(block.cells.map((cell) => `${cell.row},${cell.col}`));
		const has = (row, col) => filled.has(`${row},${col}`);
		for (const cell of block.cells) {
			const tile = document.createElement("span");
			tile.className = "tile";
			tile.style.setProperty("--r", String(cell.row - top));
			tile.style.setProperty("--c", String(cell.col - left));
			// A side with no neighbour is the outside of the block and gets the
			// inset; a shared side gets none, so two tiles meet as one shape.
			const open = {
				top: !has(cell.row - 1, cell.col),
				right: !has(cell.row, cell.col + 1),
				bottom: !has(cell.row + 1, cell.col),
				left: !has(cell.row, cell.col - 1),
			};
			tile.style.setProperty("--pt", open.top ? "var(--pad)" : "0px");
			tile.style.setProperty("--pr", open.right ? "var(--pad)" : "0px");
			tile.style.setProperty("--pb", open.bottom ? "var(--pad)" : "0px");
			tile.style.setProperty("--pl", open.left ? "var(--pad)" : "0px");
			tile.style.borderRadius = [
				open.top && open.left,
				open.top && open.right,
				open.bottom && open.right,
				open.bottom && open.left,
			]
				.map((round) => (round ? "var(--tile-radius)" : "0px"))
				.join(" ");
			element.append(tile);
		}

		const head = headCell(block);
		const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		arrow.setAttribute("class", "arrow");
		arrow.setAttribute("viewBox", "0 0 24 24");
		arrow.setAttribute("aria-hidden", "true");
		arrow.innerHTML = '<path d="M12 4 L21 14 H16 V21 H8 V14 H3 Z" />';
		arrow.style.setProperty("--r", String(head.row - top));
		arrow.style.setProperty("--c", String(head.col - left));
		arrow.style.rotate = `${block.dir * 90}deg`;
		element.append(arrow);

		return element;
	}

	/**
	 * Sizes the board to whatever room it has and repositions everything.
	 *
	 * The frame carries the gates, so it is sized from the cell rather than being
	 * a fixed number of pixels: a gate on a small board should still read as a
	 * mouth wide enough to fit the block coming through it.
	 */
	_layout() {
		const level = this.game.level;
		if (level === null || this._blocks.length === 0) return;
		const width = this.root.clientWidth;
		const height = this.root.clientHeight;
		if (width === 0 || height === 0) return;

		const rough = Math.min(width / (level.cols + 0.8), height / (level.rows + 0.8));
		const frame = Math.round(Math.min(Math.max(rough * 0.34, 9), 22));
		// The floor keeps a board on a very short screen small rather than absent;
		// no real phone gets near it.
		const step = Math.max(
			16,
			Math.floor(
				Math.min((width - frame * 2) / level.cols, (height - frame * 2) / level.rows, 92),
			),
		);
		this._step = step;
		this._frame = frame;
		this._board.style.setProperty("--step", `${step}px`);
		this._board.style.setProperty("--frame", `${frame}px`);

		for (const { element, run } of this._gates) {
			const along = frame + run.start * step;
			const length = run.length * step;
			const across = run.dir === Dir.UP || run.dir === Dir.LEFT
				? 0
				: (run.dir === Dir.DOWN ? frame + level.rows * step : frame + level.cols * step);
			if (run.dir === Dir.UP || run.dir === Dir.DOWN) {
				Object.assign(element.style, {
					left: `${along}px`,
					top: `${across}px`,
					width: `${length}px`,
					height: `${frame}px`,
				});
			} else {
				Object.assign(element.style, {
					top: `${along}px`,
					left: `${across}px`,
					height: `${length}px`,
					width: `${frame}px`,
				});
			}
		}

		for (let index = 0; index < this._blocks.length; index += 1) {
			this._settle(this._blocks[index], index, 0);
		}
	}

	/** Puts a block where the game says it is, over `ms` milliseconds. */
	_settle(element, index, ms) {
		const state = this.game.board;
		const gone = state.removed[index];
		const { dr, dc } = state.offsets[index];
		let x = dc * this._step;
		let y = dr * this._step;
		if (gone) {
			const { dr: sr, dc: sc } = STEP[this.game.level.blocks[index].dir];
			const reach = this._exitReach(index);
			x += sc * reach;
			y += sr * reach;
		}
		element.classList.toggle("is-gone", gone);
		element.disabled = gone;
		this._move(element, x, y, gone ? 0 : 1, ms);
		this._label(element, index);
	}

	/**
	 * Names a block by what it is and where it is. Rewritten as it moves, since
	 * where it is now is the part that decides whether tapping it helps.
	 */
	_label(element, index) {
		const block = this.game.level.blocks[index];
		const { dr, dc } = this.game.board.offsets[index];
		const row = Math.min(...block.cells.map((cell) => cell.row)) + dr + 1;
		const col = Math.min(...block.cells.map((cell) => cell.col)) + dc + 1;
		element.setAttribute(
			"aria-label",
			`${COLOURS[block.colour]} block facing ${DIRECTION_NAMES[block.dir]}, row ${row} column ${col}`,
		);
	}

	/** How far past the edge an escaping block has to travel to be out of sight. */
	_exitReach(index) {
		const block = this.game.level.blocks[index];
		const vertical = block.dir === Dir.UP || block.dir === Dir.DOWN;
		const cells = block.cells.map((cell) => (vertical ? cell.row : cell.col));
		const extent = Math.max(...cells) - Math.min(...cells) + 1;
		return (extent + BoardView.EXIT_CELLS) * this._step + this._frame;
	}

	_animate(move, undone) {
		const element = this._blocks[move.index];
		if (element === undefined) return;
		const ms = this._duration(move);
		if (undone && move.escaped) {
			// Coming back in through the gate it left by, rather than blinking into
			// place: the move is being taken back, so show it in reverse.
			const { dr, dc } = this.game.board.offsets[move.index];
			const step = STEP[this.game.level.blocks[move.index].dir];
			const reach = this._exitReach(move.index);
			element.classList.remove("is-gone");
			element.disabled = false;
			this._move(
				element,
				(dc + move.dc) * this._step + step.dc * reach,
				(dr + move.dr) * this._step + step.dr * reach,
				0,
				0,
			);
			this._blockLayer.offsetHeight;
			this._move(element, dc * this._step, dr * this._step, 1, ms);
			return;
		}
		this._settle(element, move.index, ms);
	}

	_move(element, x, y, opacity, ms) {
		element.style.transitionDuration = `${ms}ms`;
		element.style.translate = `${x}px ${y}px`;
		element.style.opacity = String(opacity);
	}

	_duration(move) {
		if (this._reduced.matches) return 0;
		const cells = Math.max(move.steps, 1) + (move.escaped ? 2 : 0);
		return Math.min(
			Math.max(cells * BoardView.MS_PER_CELL, BoardView.MIN_MS),
			BoardView.MAX_MS,
		);
	}

	_shake(index) {
		const element = this._blocks[index];
		if (element === undefined || this._reduced.matches) return;
		element.classList.remove("is-stuck");
		// Restart the animation rather than let a second tap land on a class that
		// is already there and produce nothing.
		this._blockLayer.offsetHeight;
		element.classList.add("is-stuck");
	}
}

/** Which cell an arrow sits on: the middle of the block's leading edge. */
function headCell(block) {
	const { dr, dc } = STEP[block.dir];
	const along = (cell) => cell.row * dr + cell.col * dc;
	const front = Math.max(...block.cells.map(along));
	const edge = block.cells.filter((cell) => along(cell) === front);
	return edge[Math.floor((edge.length - 1) / 2)];
}

/** Runs of touching gate cells of one colour, which is what gets drawn as a bar. */
function gateRuns(level) {
	const runs = [];
	for (const dir of [Dir.UP, Dir.RIGHT, Dir.DOWN, Dir.LEFT]) {
		const lanes = level.gates[dir];
		let start = -1;
		for (let lane = 0; lane <= lanes.length; lane += 1) {
			const colour = lanes[lane] ?? "";
			const previous = lanes[start] ?? "";
			if (start >= 0 && colour !== previous) {
				runs.push({ dir, colour: previous, start, length: lane - start });
				start = -1;
			}
			if (colour !== "" && start < 0) start = lane;
		}
	}
	return runs;
}
