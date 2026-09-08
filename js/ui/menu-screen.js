import { DIFFICULTIES } from "../game/ladder.js";
import { Emitter } from "../util/emitter.js";

/**
 * Title screen, and the ways off it.
 *
 * The play button carries on: a suspended level if there is one, otherwise the
 * level the player is on. Under it, and only when the two have parted company, a
 * button back to the furthest level they have reached -- the way up again after
 * dropping onto an earlier level. Then Easy, Medium and Hard, which each start
 * their part of the ladder from its first level.
 *
 * There is no grid of levels to pick from any more. Levels are generated, so the
 * ladder runs on without end and level seven is a different board every time; a
 * grid of numbers would be offering boards that do not exist yet.
 *
 * The menu decides nothing. It reports the press and lets the router work out
 * whether there is a game to resume; all it asks the save for is what to put on
 * the buttons.
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

		this._playButton.addEventListener("click", () => this.emit("playRequested"));
		this._furthestButton.addEventListener("click",
			() => this.emit("levelRequested", this.save.unlocked()));

		save.on("progressChanged", () => this.refresh());
		save.on("sessionAvailable", () => this.refresh());
		this._buildDifficulties();
		this.refresh();
	}

	refresh() {
		const unlocked = this.save.unlocked();
		const cleared = this.save.levelsCleared();
		const carryingOn = this._renderPlayButton();
		this._renderFurthest(carryingOn, unlocked);

		this._progress.textContent = cleared === 0
			? "No levels cleared yet"
			: `${cleared} level${cleared === 1 ? "" : "s"} cleared  ·  up to level ${unlocked}`;
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
		this._furthestButton.textContent = `Back to level ${unlocked}`;
	}

	/**
	 * The difficulty row. Each button starts its part of the ladder from the
	 * beginning whatever the player has done since, so the labels are fixed and
	 * written once here.
	 */
	_buildDifficulties() {
		const fragment = document.createDocumentFragment();
		for (const entry of DIFFICULTIES) {
			const button = document.createElement("button");
			button.type = "button";
			const number = document.createElement("span");
			number.className = "level";
			number.textContent = `Level ${entry.from}`;
			button.append(document.createTextNode(entry.name), number);
			button.setAttribute("aria-label", `${entry.name}: level ${entry.from}`);
			button.addEventListener("click", () => this.emit("levelRequested", entry.from));
			fragment.append(button);
		}
		this._difficulty.replaceChildren(fragment);
	}
}
