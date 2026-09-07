/**
 * Offline play.
 *
 * Everything the game needs is static and small -- the levels are code, not a
 * download -- so the whole app is precached on install. A puzzle you can already
 * play should not stop working because the train went into a tunnel.
 *
 * Two strategies, split by what goes wrong when a file is stale.
 *
 * Code -- the shell, the modules, the stylesheet -- is fetched from the network
 * first and falls back to the cache. They are a few kilobytes each, so the cost
 * of asking is small, and the cost of not asking is a browser pinned to an old
 * build: a stale mix of modules fails in ways that look like the app is simply
 * broken.
 *
 * Content -- the icons -- is served cache-first. It only changes when its
 * filename does.
 */
const CACHE = "clear-out-v1";

/** Files whose freshness matters more than the round trip to check it. */
const CODE = /\.(?:html|js|css|webmanifest)$/;

const ASSETS = [
	"./",
	"index.html",
	"manifest.webmanifest",
	"css/style.css",
	"icons/icon-192.png",
	"icons/icon-512.png",
	"icons/icon-1024.png",
	"js/save-manager.js",
	"js/game/board.js",
	"js/game/game-state.js",
	"js/game/level.js",
	"js/game/levels.js",
	"js/game/solver.js",
	"js/ui/board-view.js",
	"js/ui/game-screen.js",
	"js/ui/main.js",
	"js/ui/menu-screen.js",
	"js/ui/palette.js",
	"js/util/emitter.js",
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE)
			.then((cache) => cache.addAll(ASSETS))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys()
			.then((names) => Promise.all(
				names.filter((name) => name !== CACHE).map((name) => caches.delete(name)),
			))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") return;
	if (new URL(request.url).origin !== self.location.origin) return;

	// A navigation to any URL in scope is the app itself: fall back to the shell
	// rather than 404ing, so a refresh from the home screen opens.
	if (request.mode === "navigate") {
		event.respondWith(freshest(request, "index.html"));
		return;
	}

	if (CODE.test(new URL(request.url).pathname)) {
		event.respondWith(freshest(request));
		return;
	}

	event.respondWith(
		caches.match(request).then((cached) => cached ?? store(request)),
	);
});

/** Network first, with the cache as the offline answer. */
async function freshest(request, fallback) {
	try {
		return await store(request);
	} catch (error) {
		const cached = await caches.match(request)
			?? (fallback === undefined ? undefined : await caches.match(fallback));
		if (cached !== undefined) return cached;
		throw error;
	}
}

/** Fetches and files the result, so the next load has it offline. */
async function store(request) {
	const response = await fetch(request);
	if (response.ok) {
		const copy = response.clone();
		const cache = await caches.open(CACHE);
		await cache.put(request, copy);
	}
	return response;
}
