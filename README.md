# Mona Crossing

**Little hops. Clean commits.**

An original, playable crossing game in a candy-pastel pixel neighborhood.
Dodge bug vehicles and merge-conflict trucks, ride floating commit logs and
pull-request ferries, then deliver Mona to five `main` gardens.

**Play:** https://jdooley-clt.github.io/mona-crossing/

**More games:** [GitHub Arcade](https://jdooley-clt.github.io/arcade/)

**Origins:** Mona Crossing was created by [Christina Warren (@filmgirl)](https://github.com/filmgirl) — the original lives at https://github.com/filmgirl/mona-crossing.
This copy is maintained by [@jdooley-clt](https://github.com/jdooley-clt) during her leave.

## Controls

| Input | Action |
| --- | --- |
| Arrow keys / WASD | Hop one tile; holding repeats with a cooldown |
| Start crossing / Enter | Start; resume or replay from the playfield |
| P / Escape / Pause button | Pause or resume |
| M / Sound button | Toggle generated sound effects |
| Restart | Instant fresh game with three hearts |
| Touch D-pad | Hop; hold to repeat |

Click or tap the playfield to focus it in an iframe. Keyboard events on menu
buttons, links and the help disclosure keep their native behavior.
Sound defaults off and starts only after a user gesture. Leaving the tab/window
pauses the game; resume explicitly when you return.

Cream sidewalks and the mint median are safe. Every crossing has 40 seconds.
Landing in water, touching traffic, riding off the bank, missing a garden or
entering an occupied garden costs one of three hearts. Filled gardens survive
lost hearts. New forward ground earns ten points once per crossing, each
delivery earns 100 plus five per remaining second, and all five earn 500.
Rounds gradually increase entity speeds, capped after round seven. Platform
lengths, traffic gaps, a safe spawn and safe waiting rows remain unchanged.
River logs span seven tiles and ferries seven and a half, with one-tile water gaps.
River currents move at 12–16 pixels per second in round one, about half the
original pace. Each garden has a two-tile-wide, visibly open landing entrance.
Keep Mona's feet on a deck; river carry preserves her horizontal position between
lanes, and her center can land anywhere inside an empty garden's visible entrance.

## Development

Node.js 22 or newer. No runtime dependencies, framework or bundler needed.

```sh
npm start           # http://127.0.0.1:4177/mona-crossing/
npm test            # deterministic simulation, storage, static and server tests
npm run build       # stage only the static game in dist/
npm run check       # tests and build together
```

Browser acceptance uses Playwright as a development-only dependency:

```sh
npm ci
npm run test:browser       # local Google Chrome
# On Linux/CI: npx playwright install --with-deps chromium
# then: CI=1 npm run test:browser
```

The browser suite uses real keyboard and emulated touch events, including a
complete five-garden round. Its route planner only reads cloned snapshots;
it never inserts goals, moves Mona programmatically or changes game state.
Those clock-controlled routes prove reachability, not human timing. River
regressions also check deck-edge carry, visible garden boundaries, and a minimum
76-pixel shared landing interval at the worst adjacent-platform alignment
(over 1.6 seconds of relative travel even at the round-seven speed cap).
`test/browser/river.spec.js` additionally completes a round on the real browser
clock with WASD decisions spaced 600–800 ms apart on the river and 360–520 ms
on the road. It observes current geometry
without searching future routes or modifying game state; it is automated
human-paced coverage, not a substitute for a user's playtest.

`PORT=4180 npm start` chooses another port. The preview binds to loopback.
Use an HTTP server, not `file://`, for ES modules. Relative assets work at the
origin root or the `/mona-crossing/` project path.

## Deployment

`.github/workflows/pages.yml` runs tests for pull requests and `main`. Pushes to
`main` and manual dispatches stage HTML, CSS, ES modules and `assets/`, then deploy
the resulting Pages artifact. No tests, reference images, node modules or source
checkout metadata are published. In repository Settings → Pages, select
**GitHub Actions**. The public project URL is the Play link above.

## Cabinet integration

Embed the complete document, not a cropped canvas. Recommended viewport hints:
`layout: "document"`, desktop `height: 1100`, mobile `mobileHeight: 850`.
Help is collapsed initially and remains scrollable when opened; landscape and
small focus-mode viewports can scroll to the controls.

The game works with the cabinet's `allow-scripts allow-same-origin
allow-pointer-lock` sandbox. It requires no popups, top navigation, fullscreen or
parent messaging. Pause, audio and local storage belong to this game.
The standalone footer links to GitHub Arcade in the same tab; only that link is
hidden when embedded, avoiding a cabinet inside the cabinet.

Artwork:

- `assets/mona-crossing-cover.svg`: original self-contained 640×360 cover.
- `assets/octocat.svg`: transparent cabinet-compatible character.
- `assets/mona-crossing-gameplay.png`: real gameplay capture.

## Implementation

`src/simulation.js` owns deterministic state and events; it never reads the DOM.
`src/renderer.js` paints an original 640×512 Canvas2D scene with crisp pixel
scaling. `src/app.js` owns the single animation loop, focus, pointer/keyboard
inputs, UI and tab handling. Fixed 120 Hz simulation substeps bound collision
travel to less than one pixel at maximum difficulty; large wall-time deltas are
discarded. Repeating input cannot bypass the hop cooldown. River geometry wraps
periodically, while Mona herself must hop before reaching an offscreen edge.

## Credits and rights

Original game, neighborhood, pixel buildings, bug vehicles, log/ferry art, cover
composition and generated square-wave effects are covered by `LICENSE`.
No reference screenshots, maps, character sprites or music were copied.
No external runtime requests, analytics, accounts, backend or leaderboard.

The approved simple pixel Octocat silhouette is reused from the Commit Cabinet's
`assets/octocat-candy.svg`, adapted from the
[official Octocat](https://octodex.github.com/original/). **Octocat © GitHub, Inc.**
GitHub's artwork and trademarks are subject to
[GitHub's artwork terms](https://octodex.github.com/faq/); this repository's MIT
license does **not** license those rights. This is an unofficial fan game, not
an endorsed GitHub product. Obtain permission for new uses or redistribution.

Locally hosted [Silkscreen](https://github.com/googlefonts/silkscreen) is
copyright The Silkscreen Project Authors and distributed under the
SIL Open Font License in `assets/fonts/OFL.txt`.

## Accessibility and limits

Named controls, visible focus, text HUD and polite feedback are provided.
Reduced motion removes river ornament and celebratory particles, never essential
traffic movement. No default CRT, flashes or music. Local save/audio failures
produce actionable, nonfatal notices; the game remains playable.

Canvas crossing gameplay is visual and has no screen-reader-only play mode.
Touch testing uses browser emulation, not a claim of physical-device testing.
There is no gamepad binding, swipe input, online leaderboard or cabinet bridge.
