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

/**
 * Offline play, everywhere except here.
 *
 * The worker precaches the app and then answers for it, which is the same
 * property seen from two sides: the game keeps working in a tunnel, and a local
 * edit stays invisible because the reload is served the copy the worker already
 * holds. Hard-reloading past it is browser-specific and easy to get wrong, so on
 * localhost it is not registered at all.
 *
 * Anything left registered from an earlier visit is torn down rather than merely
 * skipped, since a registration outlives the code that made it and would go on
 * serving this origin on its own.
 */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		if (LOCAL_HOSTS.includes(location.hostname)) {
			releaseWorker();
			return;
		}
		navigator.serviceWorker.register("sw.js").catch((error) => {
			// Offline play is the only casualty, and it is not worth a visible error.
			console.warn("Service worker registration failed.", error);
		});
	});
}

async function releaseWorker() {
	try {
		const registrations = await navigator.serviceWorker.getRegistrations();
		await Promise.all(registrations.map((registration) => registration.unregister()));
		// The caches outlive the registration that filled them, so they go too.
		const names = await caches.keys();
		await Promise.all(names.map((name) => caches.delete(name)));
		if (registrations.length > 0) {
			console.info("Service worker unregistered for local development. Reload once more for a clean page.");
		}
	} catch (error) {
		console.warn("Could not clear the service worker.", error);
	}
}
