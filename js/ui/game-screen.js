import { LEVELS } from "../game/game-state.js";
import { BoardView } from "./board-view.js";
import { Emitter } from "../util/emitter.js";

/**
 * The playing screen: the board, the two controls under it, and the card that
 * covers them when a level is done.
 *
 * This is the only view that knows every piece exists, and its whole job is
 * translating: a tap on the board becomes a GameState call, a GameState event
 * becomes a label. Nothing here holds game state, so the screen can be left and
 * reopened mid-level without losing anything.
 *
 * Emits: exitRequested()
 */
export class GameScreen extends Emitter {
	static STATUS_MS = 2600;

	constructor(root, game) {
		super();
		this.root = root;
		this.game = game;

		this._levelLabel = root.querySelector("#level-label");
		this._movesLabel = root.querySelector("#moves-label");
		this._progressLabel = root.querySelector("#progress-label");
		this._statusLabel = root.querySelector("#status-label");
		this._undoButton = root.querySelector("#undo-button");
		this._restartButton = root.querySelector("#restart-button");
		this._backButton = root.querySelector("#back-button");
		this._resultPanel = root.querySelector("#result-panel");
		this._resultTitle = root.querySelector("#result-title");
		this._resultDetail = root.querySelector("#result-detail");
		this._nextButton = root.querySelector("#next-button");
		this._replayButton = root.querySelector("#replay-button");
		this._resultMenuButton = root.querySelector("#result-menu-button");

		this._board = new BoardView(root.querySelector("#board-area"), game);
		this._statusTimer = null;

		this._board.on("blockTapped", (index) => this.game.tap(index));
		this._backButton.addEventListener("click", () => this._leave());
		this._resultMenuButton.addEventListener("click", () => this._leave());
		this._undoButton.addEventListener("click", () => this.game.undo());
		this._restartButton.addEventListener("click", () => this.game.restart());
		this._replayButton.addEventListener("click", () => this.game.restart());
		this._nextButton.addEventListener("click", () => {
			this.game.startLevel(this.game.levelNumber + 1);
		});

		this._wireGame();
		this._installKeyboard();
		this._resultPanel.hidden = true;
	}

	_wireGame() {
		const game = this.game;
		game.on("levelLoaded", (level) => {
			this._resultPanel.hidden = true;
			this._levelLabel.textContent = `${level.number}. ${level.name}`;
			this._statusLabel.textContent = level.number === 1
				? "Tap a block to send it the way its arrow points."
				: "";
		});
		game.on("countsChanged", (moves, cleared, total) => {
			this._movesLabel.textContent = `${moves} move${moves === 1 ? "" : "s"}, par ${game.level.par}`;
			this._progressLabel.textContent = `${cleared} of ${total} out`;
		});
		game.on("historyChanged", (canUndo) => {
			this._undoButton.disabled = !canUndo;
		});
		game.on("moveBlocked", () => this._showStatus("Something is in the way."));
		game.on("stuckChanged", (stuck) => {
			if (stuck) this._showStatus("No way out from here — undo or restart.", true);
			else this._showStatus("");
		});
		game.on("levelCompleted", (number, moves, par, best) => this._showResult(number, moves, par, best));
	}

	_showResult(number, moves, par, best) {
		const last = number >= LEVELS.length;
		this._resultTitle.textContent = last ? "That was the last one" : "Level cleared";
		const parts = [`${moves} move${moves === 1 ? "" : "s"}`, `par ${par}`];
		if (moves > par) parts.push(`best ${best}`);
		else parts.push("perfect");
		this._resultDetail.textContent = parts.join("  ·  ");
		this._nextButton.hidden = last;
		this._nextButton.textContent = `Level ${number + 1}`;
		this._resultPanel.hidden = false;
		(last ? this._resultMenuButton : this._nextButton).focus();
	}

	/**
	 * Keyboard play. Blocks are buttons, so Tab and Enter already move and press
	 * them; what is left is the two controls and a way out.
	 */
	_installKeyboard() {
		window.addEventListener("keydown", (event) => {
			if (this.root.hidden) return;
			if (event.target instanceof HTMLButtonElement && (event.key === " " || event.key === "Enter")) {
				return;
			}
			const key = event.key.toLowerCase();
			if (key === "z" || key === "u" || key === "backspace") this.game.undo();
			else if (key === "r") this.game.restart();
			else if (key === "escape") this._leave();
			else return;
			event.preventDefault();
		});
	}

	_leave() {
		this.game.suspend();
		this.emit("exitRequested");
	}

	/** A sticky message stays until something replaces it. */
	_showStatus(message, sticky = false) {
		this._statusLabel.textContent = message;
		if (this._statusTimer !== null) clearTimeout(this._statusTimer);
		this._statusTimer = null;
		if (message === "" || sticky) return;
		this._statusTimer = setTimeout(() => {
			this._statusTimer = null;
			this._statusLabel.textContent = this.game.stuck
				? "No way out from here — undo or restart."
				: "";
		}, GameScreen.STATUS_MS);
	}
}
