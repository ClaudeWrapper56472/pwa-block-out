import { BoardState } from "./board.js";
import { Level } from "./level.js";
import { isDeadEnd } from "./solver.js";
import * as Ladder from "./ladder.js";
import { buildLevel } from "../builder.js";
import { Emitter } from "../util/emitter.js";

/**
 * The running game: which level is open, where its blocks are, and what has
 * happened so far.
 *
 * Levels are generated rather than shipped, so opening one is no longer instant
 * and the screen has to be told when a board is being found. Everything else is
 * unchanged: views never touch BoardState, they call tap/undo/restart and listen
 * for what came of it.
 *
 * A move is recorded only if it changed something. Tapping a boxed-in block is
 * reported so the view can shake it, but it is not a move and does not land on
 * the undo stack.
 *
 * Emits: generationStarted(number), generationFinished(ok),
 *        levelLoaded(level), moveApplied(move), moveBlocked(index),
 *        moveUndone(move), countsChanged(moves, cleared, total),
 *        historyChanged(canUndo), stuckChanged(stuck),
 *        levelCompleted(number, moves, par)
 */

/**
 * One long-lived worker and a request/reply protocol over it.
 *
 * Falls back to building on the main thread when workers are unavailable -- the
 * page stalls for a moment, which is better than not running.
 */
class LevelWorker {
	constructor() {
		this._worker = null;
		this._pending = new Map();
		this._nextId = 1;
		try {
			this._worker = new Worker(new URL("../worker.js", import.meta.url), { type: "module" });
			this._worker.addEventListener("message", (event) => {
				const { id, spec } = event.data;
				const resolve = this._pending.get(id);
				if (resolve === undefined) return;
				this._pending.delete(id);
				resolve(spec ?? null);
			});
			this._worker.addEventListener("error", () => this._failAll());
		} catch {
			this._worker = null;
		}
	}

	build(number, seen) {
		if (this._worker === null) return Promise.resolve(buildLevel(number, seen));
		const id = this._nextId;
		this._nextId += 1;
		return new Promise((resolve) => {
			this._pending.set(id, resolve);
			this._worker.postMessage({ id, level: number, seen });
		});
	}

	_failAll() {
		for (const resolve of this._pending.values()) resolve(null);
		this._pending.clear();
	}
}

export class GameState extends Emitter {
	/**
	 * Positions the dead-end search may visit before giving up. Generated boards
	 * are held to a par window rather than a size, so this is what stops an
	 * unusually tangled one from freezing the tap that triggered it.
	 */
	static SEARCH_BUDGET = 60000;

	constructor(save) {
		super();
		this.save = save;
		this.level = null;
		this.board = null;
		this.spec = null;
		this.taps = [];
		this.finished = false;
		this.stuck = false;
		/** False until a level is opened, so idling on the menu saves nothing. */
		this.started = false;
		this.generating = false;

		/**
		 * The next level, built while the player works on the current one.
		 *
		 * Finding a board takes long enough to notice. Rather than make the player
		 * watch a spinner between levels, the next one is built in the background
		 * the moment the current one opens; by the time they finish it is waiting.
		 */
		this._ready = null;
		this._readyFor = 0;
		this._prefetching = false;
		/** Which level the prefetch *should* be building, if it drifted. */
		this._wanted = 0;

		this._worker = new LevelWorker();
		this._prefetchWorker = new LevelWorker();
	}

	get levelNumber() {
		return this.level?.number ?? Ladder.FIRST_LEVEL;
	}

	get moveCount() {
		return this.taps.length;
	}

	/** Generates a level and opens it. */
	async startLevel(number) {
		if (this.generating) return;
		const wanted = Math.max(Ladder.FIRST_LEVEL, Math.round(Number(number) || Ladder.FIRST_LEVEL));

		// Built already, while the last level was being played.
		if (this._ready !== null && this._readyFor === wanted) {
			const spec = this._ready;
			this._ready = null;
			this._readyFor = 0;
			this._open(wanted, spec);
			return;
		}

		this.generating = true;
		this.emit("generationStarted", wanted);
		// Snapshotted here, on the main thread, so the worker never reaches into
		// SaveManager while the game is running.
		const spec = await this._worker.build(wanted, [...this.save.seen()]);
		this.generating = false;
		if (spec === null) {
			this.emit("generationFinished", false);
			return;
		}
		this._open(wanted, spec);
	}

	/** Puts the same board back the way it started, rather than drawing a new one. */
	restart() {
		if (this.spec === null || this.generating) return;
		this._open(this.level.number, this.spec);
	}

	/**
	 * Reopens a suspended game by replaying its taps onto the board it was played
	 * on, which the save keeps alongside them. Replaying rather than storing
	 * positions keeps the save honest: a document that cannot be replayed under
	 * the current rules is a document that was going to desync anyway.
	 */
	resume() {
		const session = this.save.session();
		const number = Number(session.level ?? 0);
		if (number < Ladder.FIRST_LEVEL || !isObject(session.spec)) return false;
		let level = null;
		try {
			level = new Level(number, session.spec);
		} catch {
			// A board this build can no longer read. Nothing to resume.
			return false;
		}
		this._install(level, session.spec);
		for (const index of session.taps ?? []) {
			const move = this.board.tap(Number(index));
			if (move === null || move.blocked) break;
			this.taps.push(move);
		}
		this._afterChange();
		return true;
	}

	/**
	 * Starts building the level the player would get if they pressed Play right
	 * now, so sitting on the menu is not a dead moment. There is nothing to build
	 * when a suspended level is waiting to be resumed.
	 */
	prefetchUpcoming() {
		if (this.save.hasSession()) return;
		this._prefetch(this.save.playing());
	}

	tap(index) {
		if (this.finished || this.board === null) return;
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
			spec: this.spec,
			taps: this.taps.map((move) => move.index),
		});
	}

	_open(number, spec) {
		this._install(new Level(number, spec), spec);
		this.save.recordSeen(spec.fingerprint);
		this.save.recordStarted(number, spec);
		this.emit("generationFinished", true);
		this._prefetch(number + 1);
	}

	_install(level, spec) {
		this.started = true;
		this.level = level;
		this.spec = spec;
		this.board = new BoardState(level);
		this.taps = [];
		this.finished = false;
		this.stuck = false;
		this.emit("levelLoaded", level);
		this._emitCounts();
		this.emit("historyChanged", false);
	}

	/**
	 * Begins building a level in the background. Does nothing while a build is
	 * already running -- that one re-checks what is wanted when it lands.
	 */
	async _prefetch(number) {
		this._wanted = number;
		if (this._prefetching) return;
		if (this._ready !== null && this._readyFor === number) return;
		this._ready = null;
		this._readyFor = 0;

		this._prefetching = true;
		const spec = await this._prefetchWorker.build(number, [...this.save.seen()]);
		this._prefetching = false;

		// The player may have gone somewhere else while this was building. Throw it
		// away and start on what is actually wanted now.
		if (number !== this._wanted) {
			this._prefetch(this._wanted);
			return;
		}
		this._ready = spec;
		this._readyFor = spec === null ? 0 : number;
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
		this.save.recordWin(this.level.number);
		this.emit("levelCompleted", this.level.number, moves, this.level.par);
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

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
