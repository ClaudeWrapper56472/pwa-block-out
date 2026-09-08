/**
 * Self-check for the game layer.
 *
 *     node tests/verify.mjs
 *
 * Nothing here touches the DOM, so the whole layer runs under plain Node. Plain
 * assertions rather than a framework, so it runs with nothing installed.
 *
 * The point of the generator pass at the end is that nothing draws the levels by
 * hand any more, so nothing has read the board before a player does. Every board
 * the pass draws is solved here, and its declared par is checked against the
 * shortest solution the search can find -- the same check the generator makes,
 * run again from the outside on the finished article.
 *
 * The fixture is a three-by-three board:
 *
 *       g          A red, facing right, with a clear run to its gate
 *     A A .        B green, facing up, boxed in behind A
 *     . B .   r
 *     . . .
 */
import { Level, Dir } from "../js/game/level.js";
import { BoardState } from "../js/game/board.js";
import { search, isDeadEnd, par } from "../js/game/solver.js";
import { generate } from "../js/game/generator.js";
import * as Ladder from "../js/game/ladder.js";
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
	// Two blocks facing each other in a lane neither can use. Tapping the wrong
	// one first is how a real board gets stranded.
	const level = new Level(1, {
		name: "Trap",
		blocks: { A: "r>", B: "gv", X: "bv" },
		art: [
			".g...",
			"..A.r",
			"..X..",
			"..B..",
			".gb..",
		],
	});
	const state = new BoardState(level);
	const trap = level.blocks.findIndex((block) => block.id === "X");
	check("X cannot leave: the gate under it is the wrong colour", !state.canExit(trap));
	state.tap(trap);
	check("and sliding it down shuts B in", isDeadEnd(state));
}

// --- The ladder -------------------------------------------------------------

group("Ladder");
{
	eq("three ways onto it", Ladder.DIFFICULTIES.map((entry) => entry.name), ["Easy", "Medium", "Hard"]);
	eq("Easy opens on level one", Ladder.DIFFICULTIES[0].from, Ladder.FIRST_LEVEL);
	check("each opens later than the one before", Ladder.DIFFICULTIES.every((entry, index) =>
		index === 0 || entry.from > Ladder.DIFFICULTIES[index - 1].from));

	const specs = [1, 5, 10, 15, 20, 40, 400].map((level) => Ladder.specFor(level));
	check("boards never shrink as the ladder climbs",
		specs.every((spec, index) => index === 0 || spec.size >= specs[index - 1].size));
	check("nor do block counts",
		specs.every((spec, index) => index === 0 || spec.blocks >= specs[index - 1].blocks));
	check("everything stops growing at the ceiling",
		specs.at(-1).size === Ladder.MAX_SIZE && specs.at(-1).blocks === Ladder.MAX_BLOCKS);
	check("par must always be at least one tap a block",
		specs.every((spec) => spec.minPar >= spec.blocks && spec.maxPar > spec.minPar));

	eq("Easy asks for no shunt", Ladder.specFor(1).minPar, Ladder.specFor(1).blocks);
	const medium = Ladder.specFor(Ladder.DIFFICULTIES[1].from);
	eq("Medium asks for one", medium.minPar - medium.blocks, 1);
	// A level number the ladder was never asked about still has to answer.
	check("nonsense still gets a board", Ladder.specFor(-4).size >= 5 && Ladder.specFor(0).blocks >= 3);
}

// --- The generator ----------------------------------------------------------

group("Generated levels");
{
	// Spread across the ladder rather than bunched, so a band that only breaks on
	// the bigger boards cannot hide behind the small ones.
	const numbers = [1, 3, 7, 10, 12, 15, 18, 22, 30];
	let solved = 0;
	let parsMatch = 0;
	let gated = 0;
	let sized = 0;
	let shunted = 0;
	let wanted = 0;

	for (const number of numbers) {
		const spec = generate(number);
		if (spec === null) {
			process.stdout.write(`  FAIL  level ${number} produced no board\n`);
			continue;
		}
		const level = new Level(number, spec);
		const want = Ladder.specFor(number);
		const result = search(new BoardState(level), 400000);

		if (result.status === "solved") solved += 1;
		else process.stdout.write(`  FAIL  generated level ${number} is ${result.status}\n`);

		if (result.moves.length === spec.par) parsMatch += 1;
		else {
			process.stdout.write(
				`  FAIL  generated level ${number} declares par ${spec.par}, shortest is ${result.moves.length}\n`,
			);
		}

		if (level.blocks.every((block) => hasGate(level, block))) gated += 1;
		else process.stdout.write(`  FAIL  generated level ${number} has a block with no gate to reach\n`);

		if (level.rows === want.size && level.cols === want.size
			&& level.blockCount() === want.blocks) sized += 1;
		else {
			process.stdout.write(
				`  FAIL  generated level ${number} is ${level.rows}x${level.cols} with ${level.blockCount()} blocks,`
				+ ` wanted ${want.size}x${want.size} with ${want.blocks}\n`,
			);
		}

		// The par floor is what a shunt is: a tap that parks a block rather than
		// clearing it. Missing it is a weaker board, not a broken one, so it is
		// counted rather than failed -- the generator falls back to its nearest
		// miss rather than handing back nothing.
		if (want.shunts > 0) {
			wanted += 1;
			if (spec.par >= want.minPar) shunted += 1;
		}
	}

	check("every generated level can be cleared", solved === numbers.length);
	check("every declared par is the shortest solution", parsMatch === numbers.length);
	check("every block faces a gate of its own colour", gated === numbers.length);
	check("every board is the size and shape the ladder asked for", sized === numbers.length);
	check(`most boards that should need a shunt do (${shunted}/${wanted})`, shunted >= wanted - 1);
}

group("Generated levels are drawn fresh")
{
	const first = generate(8);
	const again = generate(8, 0, undefined, new Set([first.fingerprint]));
	check("a board is not handed out twice", again.fingerprint !== first.fingerprint);
	check("a fingerprint is a number", Number.isFinite(first.fingerprint));

	// Seeded, so a board that misbehaves can be got back from its seed alone.
	const seeded = generate(6, 12345);
	const repeat = generate(6, 12345);
	eq("the same seed draws the same board", repeat.art, seeded.art);
	eq("down to the blocks", repeat.blocks, seeded.blocks);
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
	eq("with nothing cleared", [fresh.cleared, fresh.seen], [0, []]);

	eq("nonsense is discarded", normalize("not a document"), fresh);
	eq("so is a document from a newer build", normalize({ version: 99, progress: { level: 9 } }), fresh);

	// A board, in the picture format the session stores it in.
	const board = { par: 2, blocks: { A: "r>", B: "g^" }, art: FIXTURE.art, fingerprint: 7 };
	const restored = normalize({
		version: SaveManager.VERSION,
		progress: { level: 4 },
		cleared: 3,
		seen: [1, 2, "bad", 4],
		session: { level: 4, spec: board, taps: [0, 2, 1] },
	});
	eq("progress survives", restored.progress.level, 4);
	eq("a document from before the playing level was kept is on its furthest", restored.progress.playing, 1);
	eq("the count of levels cleared survives", restored.cleared, 3);
	eq("unreadable fingerprints are dropped", restored.seen, [1, 2, 4]);
	eq("the furthest level is never behind the one being played", normalize({
		version: SaveManager.VERSION,
		progress: { level: 3, playing: 9 },
	}).progress, { level: 9, playing: 9 });
	eq("the session keeps its taps", restored.session.taps, [0, 2, 1]);
	eq("and the board they were played on", restored.session.spec.art, FIXTURE.art);

	eq("one bad tap drops the whole session", normalize({
		version: SaveManager.VERSION,
		session: { level: 4, spec: board, taps: [0, null, 2] },
	}).session, {});

	// The level number no longer says what the board was, so a session without
	// one is a session that cannot be replayed.
	eq("a session with no board is dropped", normalize({
		version: SaveManager.VERSION,
		session: { level: 4, taps: [0, 1] },
	}).session, {});

	// The ladder has no end, so a large level number is a real level, not junk.
	eq("a level far up the ladder is kept as it is", normalize({
		version: SaveManager.VERSION,
		progress: { level: 400 },
	}).progress.level, 400);
	eq("but a level below the first is pulled up", normalize({
		version: SaveManager.VERSION,
		progress: { level: -3 },
	}).progress.level, 1);
}

group("Moving through the levels");
{
	// Enough of localStorage for the document to be written and read back.
	const stored = new Map();
	globalThis.localStorage = {
		getItem: (key) => stored.get(key) ?? null,
		setItem: (key, value) => stored.set(key, String(value)),
	};
	const board = { par: 2, blocks: FIXTURE.blocks, art: FIXTURE.art, fingerprint: 99 };
	const save = new SaveManager();
	save.load();
	eq("a new player is on level one", [save.playing(), save.unlocked()], [1, 1]);

	save.recordStarted(15, board);
	eq("opening Hard moves the player there and unlocks up to it", [save.playing(), save.unlocked()], [15, 15]);
	check("and notes the game in progress", save.hasSession());
	eq("with the board it was played on", save.session().spec.fingerprint, 99);
	save.recordWin(15);
	eq("a win moves on to the next level", [save.playing(), save.unlocked()], [16, 16]);
	check("and closes the game in progress", !save.hasSession());

	save.recordStarted(2, board);
	eq("dropping back to an easy level keeps the furthest", [save.playing(), save.unlocked()], [2, 16]);
	save.recordWin(2);
	eq("and carrying on from there stays below it", [save.playing(), save.unlocked()], [3, 16]);
	eq("two levels cleared", save.levelsCleared(), 2);

	save.recordSeen(99);
	save.recordSeen(100);
	save.recordSeen(99);
	eq("a board seen again is not listed twice", [...save.seen()], [100, 99]);

	const reloaded = new SaveManager();
	reloaded.load();
	eq("all of which survives a reload",
		[reloaded.playing(), reloaded.unlocked(), reloaded.levelsCleared()], [3, 16, 2]);
	delete globalThis.localStorage;
}

process.stdout.write(
	failures.length === 0
		? `\n${passed} checks passed.\n`
		: `\n${passed} passed, ${failures.length} FAILED:\n  ${failures.join("\n  ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
