/**
 * Self-check for the game layer.
 *
 *     node tests/verify.mjs
 *
 * Nothing here touches the DOM, so the whole layer runs under plain Node. Plain
 * assertions rather than a framework, so it runs with nothing installed.
 *
 * The point of the level pass at the end is that a hand-drawn picture is easy to
 * get wrong in ways that are invisible until you play it: a gate on the wrong
 * edge, a block facing a wall it can never pass, an ordering that cannot be
 * satisfied. Every shipped level is solved here, and its declared par is checked
 * against the shortest solution the search can find.
 *
 * The fixture is a three-by-three board:
 *
 *       g          A red, facing right, with a clear run to its gate
 *     A A .        B green, facing up, boxed in behind A
 *     . B .   r
 *     . . .
 */
import { Level, buildLevels, Dir } from "../js/game/level.js";
import { BoardState } from "../js/game/board.js";
import { search, isDeadEnd, par } from "../js/game/solver.js";
import { LEVEL_SPECS, DIFFICULTIES } from "../js/game/levels.js";
import { normalize, emptyDocument, SaveManager } from "../js/save-manager.js";

const FIXTURE = {
	name: "Fixture",
	par: 2,
	blocks: { A: "r>", B: "g^" },
	art: [
		"..g..",
		".AA.r",
		"..B..",
		".....",
		".....",
	],
};

let passed = 0;
const failures = [];
let suite = "";

function group(name) {
	suite = name;
	process.stdout.write(`\n${name}\n`);
}

function check(message, condition) {
	if (condition) {
		passed += 1;
		return;
	}
	failures.push(`${suite}: ${message}`);
	process.stdout.write(`  FAIL  ${message}\n`);
}

function eq(message, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) {
		process.stdout.write(
			`         got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}\n`,
		);
	}
	check(message, ok);
}

function throws(message, run) {
	try {
		run();
	} catch {
		passed += 1;
		return;
	}
	failures.push(`${suite}: ${message}`);
	process.stdout.write(`  FAIL  ${message}\n`);
}

const fixture = () => new Level(1, FIXTURE);

// --- Reading the picture ----------------------------------------------------

group("Level format");
{
	const level = fixture();
	eq("board size", [level.cols, level.rows], [3, 3]);
	eq("two blocks, in reading order", level.blocks.map((block) => block.id), ["A", "B"]);
	eq("A covers two cells", level.blocks[0].cells, [
		{ row: 0, col: 0 },
		{ row: 0, col: 1 },
	]);
	eq("A faces right", level.blocks[0].dir, Dir.RIGHT);
	eq("B faces up", level.blocks[1].dir, Dir.UP);
	eq("the gate above column 1", level.gateAt(Dir.UP, 1), "g");
	eq("no gate above column 0", level.gateAt(Dir.UP, 0), "");
	eq("the gate right of row 0", level.gateAt(Dir.RIGHT, 0), "r");
	check("no walls", level.walls.every((wall) => wall === 0));

	const walled = new Level(2, { ...FIXTURE, art: ["..g..", ".AA.r", "..B..", ".#...", "....."] });
	check("a hash is a wall", walled.isWall(2, 0));
	check("and its neighbour is not", !walled.isWall(2, 1));
}

group("Pictures that are wrong");
{
	throws("a short line", () => new Level(1, { ...FIXTURE, art: ["..g..", ".AA.r", "..B.", "...", "....."] }));
	throws("an unknown edge character", () => new Level(1, { ...FIXTURE, art: ["..z..", ".AA.r", "..B..", ".....", "....."] }));
	throws("a block with no colour", () => new Level(1, { ...FIXTURE, blocks: { A: "r>" } }));
	throws("a block with no facing", () => new Level(1, { ...FIXTURE, blocks: { A: "r", B: "g^" } }));
	throws("a block listed but never drawn", () => new Level(1, { ...FIXTURE, blocks: { ...FIXTURE.blocks, C: "b<" } }));
	throws("a block in two pieces", () => new Level(1, {
		...FIXTURE,
		blocks: { A: "r>" },
		art: ["..g..", ".A.A.", ".....", ".....", "....."],
	}));
	throws("a board with no blocks", () => new Level(1, {
		...FIXTURE,
		blocks: {},
		art: ["..g..", ".....", ".....", ".....", "....."],
	}));
}

// --- Moving -----------------------------------------------------------------

group("Sliding and escaping");
{
	const state = new BoardState(fixture());
	check("A can leave", state.canExit(0));
	eq("A could also just slide one", state.maxSlide(0), 1);
	check("B cannot leave", !state.canExit(1));
	eq("B is wedged", state.maxSlide(1), 0);
	eq("both blocks are on the board", state.remaining(), 2);
	eq("only A can be tapped to any effect", state.movable(), [0]);

	const wedged = state.tap(1);
	eq("tapping B changes nothing", wedged.blocked, true);
	eq("and leaves it where it was", state.offsets[1], { dr: 0, dc: 0 });

	const move = state.tap(0);
	eq("A escapes", [move.escaped, move.blocked], [true, false]);
	check("A is off the board", state.removed[0]);
	check("B can now leave", state.canExit(1));
	eq("one block left", state.remaining(), 1);

	state.tap(1);
	check("the board is clear", state.isCleared());
}

group("Taking a move back");
{
	const state = new BoardState(fixture());
	const before = state.key();
	const move = state.tap(0);
	check("the position changed", state.key() !== before);
	state.revert(move);
	eq("and came back exactly", state.key(), before);
	check("A is on the board again", !state.removed[0]);
	check("B is boxed in again", !state.canExit(1));
}

group("A block that stops short");
{
	// C faces right into D, so it travels as far as it can and parks.
	const level = new Level(1, {
		name: "Park",
		blocks: { C: "b>", D: "yv" },
		art: [
			"......",
			".C..D.",
			"......",
			"....y.",
		],
	});
	const state = new BoardState(level);
	eq("C stops one short of D", state.maxSlide(0), 2);
	check("C has nowhere to escape to", !state.canExit(0));
	const move = state.tap(0);
	eq("so it slides and stays", [move.steps, move.escaped], [2, false]);
	eq("C is beside D now", state.cellsOf(0), [{ row: 0, col: 2 }]);
	eq("tapping again does nothing", state.tap(0).blocked, true);
}

group("A gate of the wrong colour");
{
	// A red block with a clear run to a blue gate: it parks at the edge instead.
	const level = new Level(1, {
		name: "Wrong gate",
		blocks: { A: "r>" },
		art: [
			"....",
			".A.b",
			"....",
		],
	});
	const state = new BoardState(level);
	check("the path is clear but the colour is wrong, so no exit", !state.canExit(0));
	eq("it can still slide to the edge", state.maxSlide(0), 1);
	const move = state.tap(0);
	eq("and parks there", [move.escaped, move.steps], [false, 1]);
	check("the board is not cleared", !state.isCleared());
	check("which the search knows is hopeless", isDeadEnd(state));
}

group("Cells, walls and clones");
{
	const level = new Level(1, {
		...FIXTURE,
		art: ["..g..", ".AA.r", "..B..", ".#...", "....."],
	});
	const state = new BoardState(level);
	eq("the wall is not a block", state.occupantAt(2, 0), -2);
	eq("outside the board reads as solid", state.occupantAt(-1, 0), -2);
	eq("an empty cell is empty", state.occupantAt(2, 2), -1);

	const copy = state.clone();
	copy.tap(0);
	check("a clone moves on its own", copy.key() !== state.key());

	const before = state.key();
	const snapshot = state.snapshot();
	state.tap(0);
	state.restore(snapshot);
	eq("a snapshot restores the position", state.key(), before);
	check("and puts A back", !state.removed[0]);
}

// --- Searching --------------------------------------------------------------

group("Solver");
{
	const level = fixture();
	const result = search(new BoardState(level));
	eq("the fixture is solvable", result.status, "solved");
	eq("in two taps", result.moves, [0, 1]);
	eq("par agrees", par(level), 2);
	check("and it is not a dead end", !isDeadEnd(new BoardState(level)));

	// Two blocks facing each other can never leave, so this one is unwinnable.
	const jammed = new Level(1, {
		name: "Jammed",
		blocks: { A: "r>", B: "b<" },
		art: [
			"....",
			"bABr",
			"....",
		],
	});
	check("a jammed board is reported unsolvable", isDeadEnd(new BoardState(jammed)));
}

group("Levels the player can lose");
{
	// Level 15 is built around one tap that shuts the last way out.
	const level = buildLevels(LEVEL_SPECS)[14];
	eq("it is the level with the trap", level.name, "Look first");
	const state = new BoardState(level);
	const trap = level.blocks.findIndex((block) => block.id === "X");
	check("tapping X first is not an escape", !state.canExit(trap));
	state.tap(trap);
	check("and it strands the board", isDeadEnd(state));
}

// --- The shipped levels -----------------------------------------------------

group("Level bank");
{
	const levels = buildLevels(LEVEL_SPECS);
	check("twenty levels", levels.length === 20);
	check("numbered from one, in order", levels.every((level, index) => level.number === index + 1));
	check("every level has a name", levels.every((level) => level.name.length > 0));

	let solved = 0;
	let parsMatch = 0;
	let gated = 0;
	for (const level of levels) {
		const state = new BoardState(level);
		const result = search(state, 400000);
		if (result.status === "solved") solved += 1;
		else process.stdout.write(`  FAIL  level ${level.number} is ${result.status}\n`);
		if (result.moves.length === level.par) parsMatch += 1;
		else {
			process.stdout.write(
				`  FAIL  level ${level.number} declares par ${level.par}, shortest is ${result.moves.length}\n`,
			);
		}
		if (level.blocks.every((block) => hasGate(level, block))) gated += 1;
		else process.stdout.write(`  FAIL  level ${level.number} has a block with no gate to reach\n`);
	}
	check("every level can be cleared", solved === levels.length);
	check("every declared par is the shortest solution", parsMatch === levels.length);
	check("every block faces a gate of its own colour", gated === levels.length);

	const pars = levels.map((level) => level.par);
	check("the last level is the longest", Math.max(...pars) === pars[pars.length - 1]);
	check("the first level is the shortest", Math.min(...pars) === pars[0]);
	// Par climbs through the ladder. The one drop is the level that introduces
	// sliding a block short of its gate, which is small on purpose.
	const shunt = levels.findIndex((level) => level.name === "Shunt");
	check("par never falls except at the shunt lesson",
		pars.every((value, index) => index === 0 || index === shunt || value >= pars[index - 1]));
	check("and the shunt lesson is the first level needing more taps than blocks",
		levels.findIndex((level) => level.par > level.blockCount()) === shunt);
}

group("Difficulties");
{
	const levels = buildLevels(LEVEL_SPECS);
	eq("three ways onto the ladder", DIFFICULTIES.map((entry) => entry.name), ["Easy", "Medium", "Hard"]);
	eq("Easy opens on level one", DIFFICULTIES[0].from, 1);
	check("each opens on a level that exists", DIFFICULTIES.every((entry) =>
		Number.isInteger(entry.from) && entry.from >= 1 && entry.from <= levels.length));
	check("and later than the one before", DIFFICULTIES.every((entry, index) =>
		index === 0 || entry.from > DIFFICULTIES[index - 1].from));
	eq("Medium opens on the shunt lesson", levels[DIFFICULTIES[1].from - 1].name, "Shunt");
	eq("Hard opens on the first level that can be lost", levels[DIFFICULTIES[2].from - 1].name, "Look first");

	// Somebody picking Hard wants the harder idea, not to be dropped onto the
	// longest board in the game.
	for (const [index, entry] of DIFFICULTIES.entries()) {
		const end = DIFFICULTIES[index + 1]?.from ?? levels.length + 1;
		const band = levels.slice(entry.from - 1, end - 1);
		check(`${entry.name} opens at the gentle end of its band`,
			band.every((level) => level.par >= band[0].par));
	}
}

/** A block can only ever leave by the gate its arrow points at. */
function hasGate(level, block) {
	const vertical = block.dir === Dir.UP || block.dir === Dir.DOWN;
	const lanes = new Set(block.cells.map((cell) => (vertical ? cell.col : cell.row)));
	return [...lanes].every((lane) => level.gateAt(block.dir, lane) === block.colour);
}

// --- Saving -----------------------------------------------------------------

group("Save document");
{
	const fresh = emptyDocument();
	eq("a fresh document starts at level one", fresh.progress, { level: 1, playing: 1 });
	eq("with nothing cleared", fresh.best, {});

	eq("nonsense is discarded", normalize("not a document", 20), fresh);
	eq("so is a document from a newer build", normalize({ version: 99, progress: { level: 9 } }, 20), fresh);

	const restored = normalize({
		version: SaveManager.VERSION,
		progress: { level: 4 },
		best: { 1: 3, 2: 5, 99: 1, bad: 2, 3: 0 },
		session: { level: 4, taps: [0, 2, 1] },
	}, 20);
	eq("progress survives", restored.progress.level, 4);
	eq("a document from before the playing level was kept is on its furthest", restored.progress.playing, 4);
	eq("the furthest level is never behind the one being played", normalize({
		version: SaveManager.VERSION,
		progress: { level: 3, playing: 9 },
	}, 20).progress, { level: 9, playing: 9 });
	eq("out-of-range and junk best scores are dropped", Object.keys(restored.best).sort(), ["1", "2"]);
	eq("the session keeps its taps", restored.session.taps, [0, 2, 1]);

	eq("one bad tap drops the whole session", normalize({
		version: SaveManager.VERSION,
		session: { level: 4, taps: [0, null, 2] },
	}, 20).session, {});

	eq("a level past the end is pulled back", normalize({
		version: SaveManager.VERSION,
		progress: { level: 400 },
	}, 20).progress.level, 20);
	eq("a session for a level that does not exist is dropped", normalize({
		version: SaveManager.VERSION,
		session: { level: 44, taps: [] },
	}, 20).session, {});
}

group("Moving through the levels");
{
	// Enough of localStorage for the document to be written and read back.
	const stored = new Map();
	globalThis.localStorage = {
		getItem: (key) => stored.get(key) ?? null,
		setItem: (key, value) => stored.set(key, String(value)),
	};
	const save = new SaveManager(20);
	save.load();
	eq("a new player is on level one", [save.playing(), save.unlocked()], [1, 1]);

	save.recordStarted(15);
	eq("opening Hard moves the player there and unlocks up to it", [save.playing(), save.unlocked()], [15, 15]);
	check("and notes the game in progress", save.hasSession());
	save.recordWin(15, 9);
	eq("a win moves on to the next level", [save.playing(), save.unlocked()], [16, 16]);
	check("and closes the game in progress", !save.hasSession());

	save.recordStarted(2);
	eq("dropping back to an easy level keeps the furthest", [save.playing(), save.unlocked()], [2, 16]);
	save.recordWin(2, 4);
	eq("and carrying on from there stays below it", [save.playing(), save.unlocked()], [3, 16]);

	save.recordWin(20, 15);
	eq("clearing the last level stays on it", [save.playing(), save.unlocked()], [20, 20]);

	const reloaded = new SaveManager(20);
	reloaded.load();
	eq("all of which survives a reload",
		[reloaded.playing(), reloaded.unlocked(), reloaded.bestFor(15)], [20, 20, 9]);
	delete globalThis.localStorage;
}

process.stdout.write(
	failures.length === 0
		? `\n${passed} checks passed.\n`
		: `\n${passed} passed, ${failures.length} FAILED:\n  ${failures.join("\n  ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
