import { Emitter } from "./util/emitter.js";

/**
 * The save document in localStorage: the level the player is on, the furthest
 * they have reached, their best move count per level, and the game they are in
 * the middle of.
 *
 * Two progress numbers, because the menu can send a player backwards. The
 * level being played moves both ways; the furthest reached only climbs, and is
 * what the level grid unlocks up to. The two agree until a difficulty button or
 * the grid drops the player onto an earlier level.
 *
 * Writing is driven by an event. SaveManager announces that it is about to
 * write, whoever owns live state hands it over, and the write happens -- so
 * nothing here needs to know GameState exists.
 *
 * A browser tab can be discarded without warning, so every hook that might be
 * the last one flushes.
 *
 * Emits: saveRequested(), progressChanged(), sessionAvailable(available)
 */
export class SaveManager extends Emitter {
	static STORAGE_KEY = "clear-out.save";

	/**
	 * Bumped when the shape of the document changes. A document from a newer
	 * build is discarded rather than guessed at, since fields we would silently
	 * drop are worse than a fresh start.
	 */
	static VERSION = 1;

	constructor(levelCount) {
		super();
		this.levelCount = levelCount;
		this._document = emptyDocument();
		this._loaded = false;
	}

	load() {
		this._loaded = true;
		let parsed = null;
		try {
			parsed = JSON.parse(localStorage.getItem(SaveManager.STORAGE_KEY) ?? "null");
		} catch {
			// Private mode, storage disabled, or a torn document. The game plays;
			// it just cannot remember anything between visits.
			parsed = null;
		}
		this._document = normalize(parsed, this.levelCount);
		this.emit("progressChanged");
		this.emit("sessionAvailable", this.hasSession());
	}

	installSuspendHooks() {
		const flush = () => this.flush();
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") flush();
		});
		window.addEventListener("pagehide", flush);
		window.addEventListener("freeze", flush);
	}

	flush() {
		if (!this._loaded) return;
		this.emit("saveRequested");
		this._write();
	}

	/** The furthest level the player has reached. Levels are one-based. */
	unlocked() {
		return clamp(Number(this._document.progress.level ?? 1), 1, this.levelCount);
	}

	/** The level the player is on: the one the play button starts. */
	playing() {
		return clamp(Number(this._document.progress.playing ?? 1), 1, this.levelCount);
	}

	levelsCompleted() {
		return Object.keys(this._document.best).length;
	}

	/** Fewest moves the player has cleared `number` in, or 0 if never cleared. */
	bestFor(number) {
		return Number(this._document.best[String(number)] ?? 0);
	}

	/** Records a win and moves the player on to the next level. Returns the best move count. */
	recordWin(number, moves) {
		const key = String(number);
		const previous = Number(this._document.best[key] ?? 0);
		const best = previous === 0 ? moves : Math.min(previous, moves);
		this._document.best[key] = best;
		const next = clamp(number + 1, 1, this.levelCount);
		this._document.progress.playing = next;
		this._document.progress.level = Math.max(this.unlocked(), next);
		this._document.session = {};
		this._write();
		this.emit("progressChanged");
		this.emit("sessionAvailable", false);
		return best;
	}

	hasSession() {
		return Number(this._document.session?.level ?? 0) > 0;
	}

	session() {
		return this._document.session ?? {};
	}

	/** Called from a saveRequested handler. */
	submitSession(session) {
		this._document.session = session;
	}

	/**
	 * Records a level being opened. Opening one is what moves the player to it,
	 * so it becomes the level they are on, and the furthest reached when it is
	 * past that. The session is noted too, so a tab discarded on move one still
	 * resumes.
	 */
	recordStarted(number) {
		const level = clamp(number, 1, this.levelCount);
		this._document.progress.playing = level;
		this._document.progress.level = Math.max(this.unlocked(), level);
		this._document.session = { level, taps: [] };
		this._write();
		this.emit("progressChanged");
		this.emit("sessionAvailable", true);
	}

	clearSession() {
		this._document.session = {};
		this._write();
		this.emit("sessionAvailable", false);
	}

	_write() {
		this._document.version = SaveManager.VERSION;
		try {
			localStorage.setItem(SaveManager.STORAGE_KEY, JSON.stringify(this._document));
		} catch (error) {
			// Out of quota, or storage blocked. Losing the write is bad; taking the
			// running game down with it would be worse.
			console.warn("Could not write the save document.", error);
		}
	}
}

/** Coerces whatever was in storage into a document this build can use. */
export function normalize(data, levelCount) {
	const document = emptyDocument();
	if (!isObject(data)) return document;
	if (Number(data.version ?? 0) !== SaveManager.VERSION) return document;

	const level = Number(data.progress?.level ?? 1);
	// A document from before the level being played was recorded is on its furthest.
	const playing = Number(data.progress?.playing ?? level);
	document.progress.playing = clamp(Number.isFinite(playing) ? playing : 1, 1, levelCount);
	// The furthest level is never behind the one being played, whatever a
	// hand-edited document says.
	document.progress.level = Math.max(
		clamp(Number.isFinite(level) ? level : 1, 1, levelCount),
		document.progress.playing,
	);

	if (isObject(data.best)) {
		for (const [key, value] of Object.entries(data.best)) {
			const number = Number(key);
			const moves = Number(value);
			if (!Number.isInteger(number) || number < 1 || number > levelCount) continue;
			if (!Number.isInteger(moves) || moves < 1) continue;
			document.best[String(number)] = moves;
		}
	}

	// The session is a list of taps to replay, so a single bad entry would shift
	// every move after it. One junk entry drops the whole session rather than
	// replaying a game the player never played.
	const session = data.session;
	if (isObject(session) && Array.isArray(session.taps)) {
		const number = Number(session.level ?? 0);
		const taps = session.taps;
		const usable = Number.isInteger(number) && number >= 1 && number <= levelCount
			&& taps.every((tap) => Number.isInteger(tap) && tap >= 0);
		if (usable) document.session = { level: number, taps: [...taps] };
	}
	return document;
}

export function emptyDocument() {
	return {
		version: SaveManager.VERSION,
		progress: { level: 1, playing: 1 },
		best: {},
		session: {},
	};
}

function clamp(value, low, high) {
	return Math.min(Math.max(Math.round(value), low), high);
}

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
