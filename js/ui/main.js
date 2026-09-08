import { SaveManager } from "../save-manager.js";
import { GameState } from "../game/game-state.js";
import { MenuScreen } from "./menu-screen.js";
import { GameScreen } from "./game-screen.js";

/**
 * Boot and screen router.
 *
 * Both screens exist from the start and are shown or hidden rather than built
 * and thrown away. There are two of them, they are cheap, and keeping them alive
 * means the board does not rebuild every time the player checks the menu.
 */

const save = new SaveManager();
save.load();
save.installSuspendHooks();

const game = new GameState(save);
save.on("saveRequested", () => game.suspend());

const menuRoot = document.querySelector("#menu-screen");
const gameRoot = document.querySelector("#game-screen");
const menu = new MenuScreen(menuRoot, save);
const screen = new GameScreen(gameRoot, game);

function showMenu() {
	menuRoot.hidden = false;
	gameRoot.hidden = true;
	menu.refresh();
	// Sitting on the menu is a good moment to find the next board, so pressing
	// play does not start with a wait.
	game.prefetchUpcoming();
}

function showGame() {
	menuRoot.hidden = true;
	gameRoot.hidden = false;
}

// Resuming is just what "play" means when there is something to resume.
menu.on("playRequested", () => {
	showGame();
	if (!game.resume()) game.startLevel(save.playing());
});

// The difficulty buttons and the way back to the furthest level both name a
// level to start. Opening it takes over the session.
menu.on("levelRequested", (number) => {
	showGame();
	game.startLevel(number);
});

screen.on("exitRequested", showMenu);

showMenu();

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("sw.js").catch((error) => {
			// Offline play is the only casualty, and it is not worth a visible error.
			console.warn("Service worker registration failed.", error);
		});
	});
}
