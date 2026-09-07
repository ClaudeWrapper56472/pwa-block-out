import { BoardState } from "./board.js";
import { buildLevels } from "./level.js";
import { LEVEL_SPECS } from "./levels.js";
import { isDeadEnd } from "./solver.js";
import { Emitter } from "../util/emitter.js";

/** Every level, built once. Levels are code, so this cannot fail at runtime. */
export const LEVELS = buildLevels(LEVEL_SPECS);

/**
 * The running game: which level is open, where its blocks are, and what has
 * happened so far.
 *
 * Views never touch BoardState. They call tap/undo/restart and listen for what
 * came of it, so the same board can be driven by a keyboard, a pointer, or the
 * resume path replaying a saved game.
 *
 * A move is recorded only if it changed something. Tapping a boxed-in block is
 * reported so the view can shake it, but it is not a move and does not land on
 * the undo stack.
 *
 * Emits: levelLoaded(level), moveApplied(move), moveBlocked(index),
 *        moveUndone(move), countsChanged(moves, cleared, total),
 *        historyChanged(canUndo), stuckChanged(stuck),
 *        levelCompleted(number, moves, par, best)
 */
export class GameState extends Emitter {
	/**
	 * Positions the dead-end search may visit before giving up. The hardest
	 * shipped level has about 4,400 reachable positions, so this never runs out
	 * in practice; it is here so a future level cannot freeze the tap that
	 * triggered it.
	 */
	static SEARCH_BUDGET = 60000;

	constructor(save) {
		super();
		this.save = save;
		this.level = LEVELS[0];
		this.board = new BoardState(this.level);
		this.taps = [];
		this.finished = false;
		this.stuck = false;
		/** False until a level is opened, so idling on the menu saves nothing. */
		this.started = false;
	}

	get levelNumber() {
		return this.level.number;
	}

	get moveCount() {
		return this.taps.length;
	}

	startLevel(number) {
		this.started = true;
		this.level = LEVELS[clampIndex(number)];
		this.board = new BoardState(this.level);
		this.taps = [];
		this.finished = false;
		this.stuck = false;
		this.emit("levelLoaded", this.level);
		this._emitCounts();
		this.emit("historyChanged", false);
		this.save.recordStarted(this.level.number);
	}

	restart() {
		this.startLevel(this.level.number);
	}

	/**
	 * Reopens a suspended game by replaying its taps. Replaying rather than
	 * storing positions keeps the save honest: a document that cannot be replayed
	 * under the current rules is a document that was going to desync anyway.
	 */
	resume() {
		const session = this.save.session();
		const number = Number(session.level ?? 0);
		if (number < 1 || number > LEVELS.length) return false;
		this.startLevel(number);
		for (const index of session.taps ?? []) {
			const move = this.board.tap(Number(index));
			if (move === null || move.blocked) break;
			this.taps.push(move);
		}
		this.emit("levelLoaded", this.level);
		this._afterChange();
		return true;
	}

	tap(index) {
		if (this.finished) return;
		const move = this.board.tap(index);
		if (move === null) return;
		if (move.blocked) {
			this.emit("moveBlocked", index);
			return;
		}
		this.taps.push(move);
		this.emit("moveApplied", move);
		this._afterChange();
	}

	undo() {
		if (this.finished || this.taps.length === 0) return;
		const move = this.taps.pop();
		this.board.revert(move);
		this.emit("moveUndone", move);
		this._afterChange();
	}

	canUndo() {
		return !this.finished && this.taps.length > 0;
	}

	/** Writes the game in progress, or clears it once the level is done. */
	suspend() {
		if (!this.started) return;
		if (this.finished) {
			this.save.clearSession();
			return;
		}
		this.save.submitSession({
			level: this.level.number,
			taps: this.taps.map((move) => move.index),
		});
	}

	_afterChange() {
		this._emitCounts();
		this.emit("historyChanged", this.canUndo());
		if (this.board.isCleared()) {
			this._finish();
			return;
		}
		this._checkStuck();
	}

	_finish() {
		this.finished = true;
		this._setStuck(false);
		this.emit("historyChanged", false);
		const moves = this.taps.length;
		const best = this.save.recordWin(this.level.number, moves);
		this.emit("levelCompleted", this.level.number, moves, this.level.par, best);
	}

	/**
	 * A block that slid but could not leave may have shut the last way out. The
	 * search only speaks up when it has proved there is none, so a warning is
	 * never a guess.
	 */
	_checkStuck() {
		this._setStuck(isDeadEnd(this.board, GameState.SEARCH_BUDGET));
	}

	_setStuck(stuck) {
		if (this.stuck === stuck) return;
		this.stuck = stuck;
		this.emit("stuckChanged", stuck);
	}

	_emitCounts() {
		const total = this.level.blockCount();
		this.emit("countsChanged", this.taps.length, total - this.board.remaining(), total);
	}
}

function clampIndex(number) {
	const index = Math.round(Number(number)) - 1;
	if (!Number.isFinite(index) || index < 0) return 0;
	return Math.min(index, LEVELS.length - 1);
}
