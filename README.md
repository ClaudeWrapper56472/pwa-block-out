# Clear Out

A sliding block puzzle, as an installable progressive web app. Original art and
twenty hand-drawn levels; the genre is the tap-to-slide colour-sort puzzle, the
contents are not anyone else's.

No dependencies, no build step, no framework. Plain ES modules served as files.

## The rules

The board holds coloured blocks, each with an arrow. Its edge is a wall with
coloured gates set into it.

**Tap a block and it goes the way its arrow points.** If it can run clear off the
board through gates of its own colour, it leaves. If something is in the way it
travels as far as it can and stops there. Clear every block to finish the level.

That second half is the whole puzzle. A block that cannot leave yet still moves,
and where it stops is somebody else's problem — usually the block that needed the
lane it just parked in. A block only ever travels along its own row or column, so
the gate it is aimed at is the only one it will ever use.

There is no move limit and nothing to lose. **Undo** takes back one tap and
**Restart** takes back all of them, which is what you want when a shunt has
walled the last way out — the game says so when that happens, rather than letting
you work it out twenty taps later.

Each level shows a par: the fewest taps that clear it. Matching par is the only
score there is.

**Easy, Medium and Hard** on the menu are three places to join the one ladder,
not three settings: levels 1, 10 and 15, each the level that introduces its
band's idea. The play button carries on from the level you are on. If a
difficulty button or the level grid has dropped you below the furthest level you
have reached, a **Back to level** button offers the way up again, and the grid
stays open up to it.

**Keyboard:** `Tab` moves between blocks, `Enter` taps one, `Z` undoes, `R`
restarts, `Esc` goes back to the menu.

## Running it

Modules and the service worker need a real origin, so open it over HTTP rather
than as a file:

```bash
cd ~/Sites/pwa-block-out
python3 -m http.server 8000
# then http://localhost:8000
```

Installing it from the browser's Add to Home Screen gives a standalone portrait
app that plays offline.

```bash
node tests/verify.mjs        # 99 assertions, about a second
node tools/make-icons.mjs    # redraws icons/, only needed if the art changes
```

The self-check needs Node 18 or newer. It runs the whole game layer headlessly:
the picture format, the movement rules, undo, and the search — and it solves
every shipped level, failing if one cannot be cleared or if its declared par is
not the shortest solution.

## Layout

```
index.html               The shell: both screens, shown and hidden
manifest.webmanifest     Installability: name, icons, portrait, standalone
sw.js                    Precaches everything; code network-first, icons cache-first
css/style.css            Chrome, layout, and every board rule

js/game/                 Pure game logic. No DOM, so it all runs under Node.
  level.js               The picture format, and one parsed level
  levels.js              The twenty levels, as pictures, and where Easy, Medium and Hard begin
  board.js               Where the blocks are, and the rules for moving one
  solver.js              Breadth-first search: par, and "is this still winnable"
  game-state.js          The running game, and every event the UI listens to

js/
  save-manager.js        The save document in localStorage, plus suspend hooks
  util/emitter.js        Named events
  ui/                    palette.js, board-view.js, menu-screen.js,
                         game-screen.js, main.js

icons/                   The app icons
tools/make-icons.mjs     Draws them
tests/verify.mjs         Self-check for the game layer
```

## Levels are pictures

A level is written as the board with a frame drawn round it. On the frame a
colour letter is a gate and a dot is solid edge; inside, a capital letter is a
cell of the block with that id, `#` is a wall and a dot is empty floor.

```js
{
    name: "Shunt",
    par: 5,
    blocks: { W: "y<", X: "b>", Y: "g^", Z: "rv" },
    art: [
        ".g....",
        ".XX.Zb",
        ".Y..Z.",
        "yY.WW.",
        "......",
        "....r.",
    ],
}
```

X is blocked by Z, Z by W, W by Y, and Y by X: nothing can leave. X has one cell
of room, so tapping it shunts it clear of Y's column and the ring unwinds. Five
taps for four blocks, and `par: 5` says so.

The picture is easy to get subtly wrong — a gate on the wrong edge reads fine and
plays as a level nobody can finish — so `tests/verify.mjs` solves all twenty and
checks every par against the search. Three of them can be played into a position
that cannot be won; that is deliberate, and the test asserts one of them.

## Notes on the build

**Every measurement is one number.** `BoardView` measures the board once and
publishes `--step`; cell size, corner radius, frame thickness, gate width and the
inset around a block are all `calc()` off it. A resize sets one property rather
than relaying out each tile.

**Blocks are `<button>` elements.** They behave like buttons — one press, one
move — and that hands over keyboard access, focus rings and the platform's own
idea of what counts as a tap, none of which a div would have. A multi-cell block
is one button holding one element per cell; a side shared with another cell of
the same block gets no inset, so the tiles meet and the block reads as one piece.

**The dead-end warning is a proof, not a guess.** After every move the solver
searches the positions still reachable. It only says you are stuck when it has
visited all of them and none wins; if it runs out of budget first it says
nothing. The hardest level has about 4,400 reachable positions, so it never comes
close.

**Suspended games are stored as a list of taps and replayed.** A saved position
could disagree with the rules that produced it; a list of taps either replays or
is discarded.

## Deliberate omissions

- **No accounts, ads, leaderboards, purchases or analytics.** Nothing leaves the
  device; the save document is the only thing written anywhere.
- **No timer.** Par counts taps, and a clock would only make a thinking game feel
  like a rushing one.
- **No hints.** The solver knows the shortest way home from wherever you are, so
  the only hint it could give is the answer.
- **No sound.**
