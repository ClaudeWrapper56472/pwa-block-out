import { Emitter } from "./util/emitter.js";
import * as Ladder from "./game/ladder.js";

/**
 * The save document in localStorage: the level the player is on, the furthest
 * they have reached, and the game they are in the middle of.
 *
 * Two progress numbers, because the menu can send a player backwards. The level
 * being played moves both ways; the furthest reached only climbs. The two agree
 * until a difficulty button drops the player onto an earlier level.
 *
 * Levels are generated, so the ladder has no end and nothing here is clamped to
 * a level count. It also means a level number no longer identifies a board: the
 * board in progress is kept in the session alongside the taps played on it,
 * because next time it would be a different one.
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
	static VERSION = 2;

	/**
	 * How many boards are remembered to avoid handing one out twice.
	 *
	 * Fingerprints, not boards. A few hundred hashes cost nothing and cover far
	 * more levels than anyone plays in a sitting; forgetting the oldest costs at
	 * worst one repeated board, long after it would be recognised.
	 */
	static SEEN_LIMIT = 400;

	constructor() {
		super();
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
		this._document = normalize(parsed);
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
		return atLeastFirst(this._document.progress.level);
	}

	/** The level the player is on: the one the play button starts. */
	playing() {
		return atLeastFirst(this._document.progress.playing);
	}

	levelsCleared() {
		return Math.max(Number(this._document.cleared ?? 0), 0);
	}

	/** Fingerprints of boards already handed out, so one is not served twice. */
	seen() {
		return this._document.seen ?? [];
	}

	recordSeen(fingerprint) {
		const value = Number(fingerprint);
		if (!Number.isFinite(value)) return;
		const seen = this._document.seen.filter((entry) => entry !== value);
		seen.push(value);
		this._document.seen = seen.slice(-SaveManager.SEEN_LIMIT);
	}

	/** Records a win and moves the player on to the next level. */
	recordWin(number) {
		this._document.cleared += 1;
		const next = atLeastFirst(number) + 1;
		this._document.progress.playing = next;
		this._document.progress.level = Math.max(this.unlocked(), next);
		this._document.session = {};
		this._write();
		this.emit("progressChanged");
		this.emit("sessionAvailable", false);
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
	 * Records a level being opened. Opening one is what moves the player to it, so
	 * it becomes the level they are on, and the furthest reached when it is past
	 * that. The board is noted with it, so a tab discarded on move one comes back
	 * to the same puzzle rather than a fresh one.
	 */
	recordStarted(number, spec) {
		const level = atLeastFirst(number);
		this._document.progress.playing = level;
		this._document.progress.level = Math.max(this.unlocked(), level);
		this._document.session = { level, spec, taps: [] };
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
export function normalize(data) {
	const document = emptyDocument();
	if (!isObject(data)) return document;
	if (Number(data.version ?? 0) !== SaveManager.VERSION) return document;

	document.progress.playing = atLeastFirst(data.progress?.playing);
	// The furthest level is never behind the one being played, whatever a
	// hand-edited document says.
	document.progress.level = Math.max(atLeastFirst(data.progress?.level), document.progress.playing);

	const cleared = Number(data.cleared ?? 0);
	document.cleared = Number.isInteger(cleared) && cleared > 0 ? cleared : 0;

	if (Array.isArray(data.seen)) {
		document.seen = data.seen
			.map(Number)
			.filter((entry) => Number.isFinite(entry))
			.slice(-SaveManager.SEEN_LIMIT);
	}

	// The session is a board plus a list of taps to replay onto it, so a single
	// bad entry would shift every move after it. One junk entry drops the whole
	// session rather than replaying a game the player never played.
	const session = data.session;
	if (isObject(session) && Array.isArray(session.taps) && isSpec(session.spec)) {
		const number = Number(session.level ?? 0);
		const usable = Number.isInteger(number) && number >= Ladder.FIRST_LEVEL
			&& session.taps.every((tap) => Number.isInteger(tap) && tap >= 0);
		if (usable) {
			document.session = { level: number, spec: session.spec, taps: [...session.taps] };
		}
	}
	return document;
}

export function emptyDocument() {
	return {
		version: SaveManager.VERSION,
		progress: { level: Ladder.FIRST_LEVEL, playing: Ladder.FIRST_LEVEL },
		cleared: 0,
		seen: [],
		session: {},
	};
}

/** Enough of a level spec to be worth handing to the parser, which checks the rest. */
function isSpec(spec) {
	return isObject(spec) && Array.isArray(spec.art) && isObject(spec.blocks);
}

function atLeastFirst(value) {
	const number = Math.round(Number(value));
	return Number.isFinite(number) ? Math.max(number, Ladder.FIRST_LEVEL) : Ladder.FIRST_LEVEL;
}

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
