import { LEVELS } from "../game/game-state.js";
import { DIFFICULTIES } from "../game/levels.js";
import { Emitter } from "../util/emitter.js";

/**
 * Title screen, and the ways off it.
 *
 * The play button carries on: a suspended level if there is one, otherwise the
 * level the player is on. Under it, and only when the two have parted company,
 * a button back to the furthest level they have reached -- the way up again
 * after dropping onto an earlier level. Then Easy, Medium and Hard, which each
 * start their part of the ladder from its first level, and the grid of every
 * level behind them.
 *
 * The menu decides nothing. It reports the press and lets the router work out
 * whether there is a game to resume; all it asks the save for is what to put on
 * the buttons and which levels to unlock.
 *
 * Emits: playRequested(), levelRequested(number)
 */
export class MenuScreen extends Emitter {
	constructor(root, save) {
		super();
		this.root = root;
		this.save = save;
		this._playButton = root.querySelector("#play-button");
		this._furthestButton = root.querySelector("#furthest-button");
		this._difficulty = root.querySelector("#difficulty");
		this._progress = root.querySelector("#menu-progress");
		this._grid = root.querySelector("#level-grid");

		this._playButton.addEventListener("click", () => this.emit("playRequested"));
		this._furthestButton.addEventListener("click",
			() => this.emit("levelRequested", this.save.unlocked()));
		this._grid.addEventListener("click", (event) => {
			const button = event.target.closest("button");
			if (button === null || button.disabled) return;
			this.emit("levelRequested", Number(button.dataset.level));
		});

		save.on("progressChanged", () => this.refresh());
		save.on("sessionAvailable", () => this.refresh());
		this._buildDifficulties();
		this._buildGrid();
	}

	refresh() {
		const unlocked = this.save.unlocked();
		const cleared = this.save.levelsCompleted();
		const carryingOn = this._renderPlayButton();
		this._renderFurthest(carryingOn, unlocked);

		this._progress.textContent =
			`${cleared} of ${LEVELS.length} levels cleared` +
			(cleared < LEVELS.length ? ` · up to level ${unlocked}` : "");

		for (const button of this._grid.children) {
			const number = Number(button.dataset.level);
			const best = this.save.bestFor(number);
			button.disabled = number > unlocked;
			button.classList.toggle("is-done", best > 0);
			button.classList.toggle("is-next", number === unlocked && best === 0);
			const par = LEVELS[number - 1].par;
			button.title = best > 0
				? `${LEVELS[number - 1].name} — best ${best} moves, par ${par}`
				: LEVELS[number - 1].name;
		}
	}

	/** Writes the play button, and answers which level it would start. */
	_renderPlayButton() {
		if (this.save.hasSession()) {
			const level = Number(this.save.session().level);
			this._playButton.textContent = `Continue level ${level}`;
			return level;
		}
		const level = this.save.playing();
		this._playButton.textContent = `Play level ${level}`;
		return level;
	}

	/**
	 * The way back to the furthest level reached. Hidden while the play button is
	 * already offering it, which is the usual case: the two only part company
	 * after the player drops onto an earlier level.
	 */
	_renderFurthest(carryingOn, unlocked) {
		this._furthestButton.hidden = unlocked === carryingOn;
		if (this._furthestButton.hidden) return;
		this._furthestButton.textContent =
			`Back to level ${unlocked}  ·  ${LEVELS[unlocked - 1].name}`;
	}

	/**
	 * The difficulty row. Each button starts its part of the ladder from the
	 * beginning whatever the player has done since, so the labels are fixed and
	 * written once here.
	 */
	_buildDifficulties() {
		const fragment = document.createDocumentFragment();
		for (const entry of DIFFICULTIES) {
			const level = LEVELS[entry.from - 1];
			const button = document.createElement("button");
			button.type = "button";
			const number = document.createElement("span");
			number.className = "level";
			number.textContent = `Level ${level.number}`;
			const name = document.createElement("span");
			name.className = "name";
			name.textContent = level.name;
			button.append(document.createTextNode(entry.name), number, name);
			button.setAttribute("aria-label", `${entry.name}: level ${level.number}, ${level.name}`);
			button.addEventListener("click", () => this.emit("levelRequested", level.number));
			fragment.append(button);
		}
		this._difficulty.replaceChildren(fragment);
	}

	_buildGrid() {
		const fragment = document.createDocumentFragment();
		for (const level of LEVELS) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "level-chip";
			button.dataset.level = String(level.number);
			button.textContent = String(level.number);
			fragment.append(button);
		}
		this._grid.replaceChildren(fragment);
		this.refresh();
	}
}
