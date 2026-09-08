# Clear Out

A sliding block puzzle, as an installable progressive web app. Original art, and
levels drawn on the device as you play; the genre is the tap-to-slide colour-sort
puzzle, the contents are not anyone else's.

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
not three settings: levels 1, 10 and 15. Easy boards come apart in whatever order
you find; Medium is where the ladder starts insisting on a shunt; Hard keeps the
shunt and grows the board around it. The play button carries on from the level
you are on. If a difficulty button has dropped you below the furthest level you
have reached, a **Back to level** button offers the way up again.

The ladder has no end. Boards grow to nine squares a side and eleven blocks and
then hold there, which is as far as a phone screen and a fingertip go.

**Keyboard:** `Tab` moves between blocks, `Enter` taps one, `Z` undoes, `R`
restarts, `Esc` goes back to the menu.

## Running it

Modules and the service worker need a real origin, so open it over HTTP rather
than as a file:

```bash
cd ~/Games/pwa-clear-out
python3 -m http.server 8000
# then http://localhost:8000
```

The service worker is not registered on `localhost`, and any copy left from an
earlier visit is unregistered on load. It caches the whole app and then answers
for it, so with it running a reload can be served the copy it already holds and
an edit appears to do nothing; hard-reloading past that is browser-specific.
Offline play therefore needs a real origin, where Add to Home Screen gives a
standalone portrait app that plays with the network off.

```bash
node tests/verify.mjs        # 103 assertions, a few seconds
node tools/make-icons.mjs    # redraws icons/, only needed if the art changes
```

The self-check needs Node 18 or newer. It runs the whole game layer headlessly:
the picture format, the movement rules, undo, and the search — and it draws
levels from across the ladder and solves each one, failing if a board cannot be
cleared or if its declared par is not the shortest solution.

## Layout

```
index.html               The shell: both screens, shown and hidden
manifest.webmanifest     Installability: name, icons, portrait, standalone
sw.js                    Precaches everything; code network-first, icons cache-first
css/style.css            Chrome, layout, and every board rule

js/game/                 Pure game logic. No DOM, so it all runs under Node.
  level.js               The picture format, and one parsed level
  ladder.js              What board a level number asks for, and where Easy, Medium and Hard begin
  generator.js           Draws a board and checks it against the search
  board.js               Where the blocks are, and the rules for moving one
  solver.js              Breadth-first search: par, and "is this still winnable"
  game-state.js          The running game, and every event the UI listens to

js/
  builder.js             One call: a level number in, a board out
  worker.js              Runs the builder off the main thread
  save-manager.js        The save document in localStorage, plus suspend hooks
  util/emitter.js        Named events
  util/rng.js            Seeded PCG32, so a board can be got back from its seed
  ui/                    palette.js, board-view.js, menu-screen.js,
                         game-screen.js, main.js

icons/                   The app icons
tools/make-icons.mjs     Draws them
tests/verify.mjs         Self-check for the game layer
```

## Levels are pictures

The generator writes the board out in the same format a level would have been
written in by hand. On the frame a colour letter is a gate and a dot is solid
edge; inside, a capital letter is a cell of the block with that id, `#` is a wall
and a dot is empty floor. A picture is a plain object, which is why it crosses
the worker boundary and goes into the save document unchanged.

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

That ring is the thing the generator has to find, and the reason it works the way
it does. Putting each block somewhere it can already leave from guarantees a
solvable board, but it guarantees a worthless one: undo the placements in reverse
and the board comes apart a block at a time, so the puzzle is only ever the order
and no block ever has to be shunted aside. Rings cannot be built that way, only
found. So blocks are scattered and the gates painted to match wherever they
landed, most of what turns up is jammed solid, and roughly one board in a
thousand is knotted and still solvable. That one is kept and the rest of the
board grown around it.

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
nothing.

**Par is the difficulty measure.** Nothing rates a generated board by how it
looks. It is solved, and the length of the shortest solution has to land inside
the window the ladder asked for — a floor, so a board cannot fall apart in a few
taps, and a ceiling, because a board needing twenty taps to unpick is not the
harder version of one needing ten, it is a slog. Par above one tap per block is
exactly the claim that some block has to be moved aside before it can leave.

**The next level is drawn while you play the current one.** Finding a board takes
long enough to notice, so it happens in a worker the moment a level opens, and
the finished board is waiting by the time it is wanted. The overlay that says so
is there for the first level of a session and for anyone who gets ahead of it.

**Suspended games are stored as a list of taps and replayed.** A saved position
could disagree with the rules that produced it; a list of taps either replays or
is discarded. The board goes in with them, because a level number no longer says
what the board was — next time it would be a different one.

## Deliberate omissions

- **No accounts, ads, leaderboards, purchases or analytics.** Nothing leaves the
  device; the save document is the only thing written anywhere.
- **No timer.** Par counts taps, and a clock would only make a thinking game feel
  like a rushing one.
- **No hints.** The solver knows the shortest way home from wherever you are, so
  the only hint it could give is the answer.
- **No level select.** Levels are drawn as they are needed, so a grid of numbers
  would be offering boards that do not exist yet.
- **No sound.**
