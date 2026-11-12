import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame, restart, start, togglePause, advance, hop, segments, setRelaxed,
  platformAt, GOALS, GOAL_WIDTH, WIDTH, DEADLINE, HOP_COOLDOWN, STEP, PLAYER_HALF, CELL, drainEvents
} from "../src/simulation.js";
import { planRoute } from "./helpers/route.js";

const playing = () => { const game = createGame(); start(game); return game; };
function run(game, seconds) {
  for (let t = 0; t < seconds - 1e-7; t += STEP) advance(game, Math.min(STEP, seconds - t));
}
function place(game, row, x = WIDTH / 2) {
  game.player = { row, x };
  game.cooldown = 0;
  game.transition = 0;
}
function deliver(game, i) {
  place(game, 1, (GOALS[i] + .5) * 32);
  assert.equal(hop(game, "up"), true);
}

test("ready game does not advance; Start is explicit", () => {
  const game = createGame();
  advance(game, 1);
  assert.equal(game.status, "ready");
  assert.equal(game.time, DEADLINE);
  start(game);
  assert.equal(game.status, "playing");
});
test("spawn remains safe for an entire timer", () => {
  const game = playing();
  run(game, 39);
  assert.equal(game.lives, 3);
  assert.equal(game.player.row, 10);
});
test("all movement directions and board boundaries", () => {
  const game = playing();
  assert.equal(hop(game, "down"), false);
  place(game, 10, 16);
  assert.equal(hop(game, "left"), false);
  assert.equal(hop(game, "right"), true);
  assert.equal(game.player.x, 48);
  place(game, 10, 464);
  assert.equal(hop(game, "right"), false);
  place(game, 10);
  assert.equal(hop(game, "left"), true);
  game.cooldown = 0;
  assert.equal(hop(game, "up"), true);
  game.transition = 0;
  game.cooldown = 0;
  game.player.row = 9;
  assert.equal(hop(game, "down"), true);
  assert.equal(game.player.row, 10);
});
test("hop cooldown rejects teleport spam and unknown directions", () => {
  const game = playing();
  hop(game, "left");
  assert.equal(hop(game, "left"), false);
  run(game, HOP_COOLDOWN + STEP);
  assert.equal(hop(game, "left"), true);
  game.cooldown = 0;
  assert.equal(hop(game, "diagonal"), false);
});
test("traffic overlap costs exactly one heart and respawns safely", () => {
  const game = playing();
  const lane = game.lanes.find(lane => lane.row === 9);
  place(game, 10, lane.phase + 20);
  hop(game, "up");
  assert.equal(game.lives, 2);
  assert.equal(game.player.row, 10);
  for (let i = 0; i < 20; i++) hop(game, "up");
  run(game, .2);
  assert.equal(game.lives, 2);
  assert.equal(game.score, 0);
});
test("fixed steps catch the fastest capped vehicle crossing Mona", () => {
  const game = playing();
  game.round = 100;
  const lane = game.lanes.find(lane => lane.row === 9);
  lane.speed = 70;
  lane.phase = 202;
  place(game, 9, 250);
  advance(game, .1);
  assert.equal(game.lives, 2);
});
test("empty river costs a heart; partial support is not a platform", () => {
  const game = playing();
  const lane = game.lanes.find(lane => lane.row === 3);
  place(game, 4, lane.phase + lane.length + 20);
  hop(game, "up");
  assert.equal(game.lives, 2);
  assert.equal(platformAt(lane, lane.phase + 3), undefined);
});
test("logs carry Mona with their exact displacement", () => {
  const game = playing();
  const lane = game.lanes.find(lane => lane.row === 3);
  place(game, 3, lane.phase + 40);
  const x = game.player.x;
  run(game, .5);
  assert.equal(game.lives, 3);
  assert.ok(Math.abs(game.player.x - (x + lane.speed * .5)) < 1e-6);
});
test("edge-case setup: both supported deck edges survive carry", () => {
  for (const row of [1, 2, 3]) {
    for (const edge of ["left", "right"]) {
      const game = playing();
      const lane = game.lanes.find(lane => lane.row === row);
      lane.phase = 64;
      const segment = segments(lane).find(segment => segment.x >= 64 && segment.x + segment.width < WIDTH);
      const x = edge === "left" ? segment.x + PLAYER_HALF : segment.x + segment.width - PLAYER_HALF;
      place(game, row, x);
      run(game, .6);
      assert.equal(game.lives, 3, `row ${row}, ${edge} edge`);
      assert.ok(Math.abs(game.player.x - x - lane.speed * .6) < 1e-7);
      assert.ok(platformAt(lane, game.player.x));
      const support = platformAt(lane, game.player.x);
      assert.equal(platformAt(lane, support.x + PLAYER_HALF - .001), undefined);
      assert.equal(platformAt(lane, support.x + support.width - PLAYER_HALF + .001), undefined);
    }
  }
});
test("river decks leave useful transfer windows at every relative alignment, including the speed cap", () => {
  const game = playing();
  game.round = 6;
  GOALS.forEach((_, i) => deliver(game, i));
  const river = game.lanes.filter(lane => lane.row <= 3);
  for (let i = 0; i < river.length - 1; i++) {
    const a = river[i];
    const b = river[i + 1];
    // Even a destination gap centered on the source leaves one contiguous
    // shared landing interval this wide (Mona's entire support footprint fits).
    const overlap = (Math.min(a.length, b.length) - 2 * PLAYER_HALF -
      (Math.max(a.gap, b.gap) + 2 * PLAYER_HALF)) / 2;
    assert.ok(overlap >= 76);
    assert.ok(overlap / (Math.abs(a.speed) + Math.abs(b.speed)) >= 1.6);
    assert.ok(a.gap >= CELL && b.gap >= CELL, "water remains a real hazard");
    for (const [source, destination] of [[a, b], [b, a]]) {
      const left = 80 + PLAYER_HALF;
      const right = 80 + source.length - PLAYER_HALF;
      for (let phase = 0; phase < destination.period; phase += .5) {
        const shared = segments({ ...destination, phase }).map(segment =>
          Math.max(0, Math.min(right, segment.x + segment.width - PLAYER_HALF) -
            Math.max(left, segment.x + PLAYER_HALF)));
        assert.ok(Math.max(...shared) >= 76, `rows ${source.row}/${destination.row}, phase ${phase}`);
      }
    }
  }
});
test("negative ferries carry; wrapping is periodic and gap-free at seam", () => {
  const game = playing();
  const lane = game.lanes.find(lane => lane.row === 2);
  lane.phase = .05;
  place(game, 2, 45);
  run(game, .2);
  assert.equal(game.lives, 3);
  assert.ok(Math.abs(game.player.x - (45 + lane.speed * .2)) < 1e-6);
  assert.ok(lane.phase >= 0 && lane.phase < lane.period);
  assert.ok(platformAt(lane, game.player.x));
  assert.deepEqual(segments({ ...lane, phase: lane.phase + lane.period }), segments(lane));
});
test("platform carrier cannot wrap player back onto board", () => {
  const game = playing();
  const lane = game.lanes.find(lane => lane.row === 3);
  lane.phase = 450 % lane.period;
  place(game, 3, WIDTH - PLAYER_HALF - lane.speed * .2);
  run(game, .4);
  assert.equal(game.lives, 2);
  assert.equal(drainEvents(game).find(e => e.type === "death").reason, "bank");
});
test("deadline loses a heart and resets timer", () => {
  const game = playing();
  game.time = .02;
  run(game, .05);
  assert.equal(game.lives, 2);
  assert.equal(game.time, DEADLINE);
});
test("relaxed timer removes the deadline, pays the base delivery reward and survives restart", () => {
  const game = createGame({ relaxed: true });
  start(game);
  run(game, DEADLINE * 2 + 10);
  assert.equal(game.status, "playing");
  assert.equal(game.lives, 3);
  assert.equal(game.time, DEADLINE);
  deliver(game, 0);
  assert.equal(game.score, 100);
  assert.equal(drainEvents(game).find(e => e.type === "goal").bonus, 100);
  restart(game);
  assert.equal(game.relaxed, true);
  assert.equal(createGame().relaxed, false);
});
test("toggling the relaxed timer mid-crossing freezes the countdown without refilling it", () => {
  const game = playing();
  run(game, 10);
  const remaining = game.time;
  assert.ok(remaining < DEADLINE);
  setRelaxed(game, true);
  run(game, DEADLINE);
  assert.equal(game.time, remaining);
  assert.equal(game.lives, 3);
  setRelaxed(game, false);
  run(game, 1);
  assert.ok(game.time < remaining);
  setRelaxed(game, "yes");
  assert.equal(game.relaxed, false);
});
test("pause freezes lanes, timer, transitions and input", () => {
  const game = playing();
  togglePause(game);
  const snapshot = JSON.stringify(game);
  advance(game, .1);
  assert.equal(hop(game, "up"), false);
  assert.equal(JSON.stringify(game), snapshot);
  togglePause(game);
  run(game, .1);
  assert.ok(game.time < DEADLINE);
});
test("up/down farming cannot re-credit visited ground", () => {
  const game = playing();
  place(game, 4);
  game.furthest = 5;
  hop(game, "left");
  assert.equal(game.score, 10);
  game.cooldown = 0;
  hop(game, "right");
  assert.equal(game.score, 10);
});
test("goal credit is unique and occupied garden costs a heart", () => {
  const game = playing();
  deliver(game, 0);
  assert.equal(game.score, 300);
  assert.equal(game.goals[0], true);
  deliver(game, 0);
  assert.equal(game.score, 300);
  assert.equal(game.lives, 2);
  assert.equal(drainEvents(game).find(e => e.type === "death").reason, "occupied");
});
test("closed garden gaps fail without reward", () => {
  const game = playing();
  place(game, 1, 96);
  hop(game, "up");
  assert.equal(game.lives, 2);
  assert.equal(game.score, 0);
});
test("edge-case setup: carried off-grid landings use the whole visible garden, not a hidden inset", () => {
  for (const col of GOALS) {
    for (const offset of [-GOAL_WIDTH / 2, -24, 24, GOAL_WIDTH / 2 - .01]) {
      const game = playing();
      place(game, 1, (col + .5) * CELL + offset);
      hop(game, "up");
      assert.equal(game.lives, 3);
      assert.equal(game.goals[GOALS.indexOf(col)], true);
    }
    const left = (col + .5) * CELL - GOAL_WIDTH / 2;
    for (const x of [left - .01, left + GOAL_WIDTH]) {
      if (x < CELL / 2 || x > WIDTH - CELL / 2) continue;
      const game = playing();
      place(game, 1, x);
      hop(game, "up");
      assert.equal(game.lives, 2, "hedges outside the visible tile remain unsafe");
    }
  }
});
test("edge-case setup: final garden remains reachable after a one-second reaction delay at the speed cap", () => {
  const game = playing();
  game.round = 6;
  GOALS.forEach((_, i) => deliver(game, i));
  const lane = game.lanes.find(lane => lane.row === 1);
  lane.phase = 160;
  place(game, 1, (GOALS[2] + .5) * CELL);
  run(game, 1);
  assert.equal(game.lives, 3);
  hop(game, "up");
  assert.equal(game.goals[2], true);
  assert.equal(game.lives, 3);
});
test("five unique goals complete a round, reset slots and cap speeds", () => {
  const game = playing();
  GOALS.forEach((_, i) => deliver(game, i));
  assert.equal(game.round, 2);
  assert.equal(game.score, 2000);
  assert.equal(game.goals.some(Boolean), false);
  assert.ok(game.transition >= 1.5);
  assert.ok(game.lanes.find(l => l.row === 9).speed > 35);
  game.round = 7;
  GOALS.forEach((_, i) => deliver(game, i));
  const cap = game.lanes.map(l => l.speed);
  game.round = 200;
  GOALS.forEach((_, i) => deliver(game, i));
  assert.deepEqual(game.lanes.map(l => l.speed), cap);
});
test("three failures give game over; restart resets every simulation field", () => {
  const game = playing();
  for (let i = 0; i < 3; i++) {
    game.transition = 0;
    game.time = STEP / 2;
    advance(game, STEP);
  }
  assert.equal(game.status, "over");
  assert.equal(game.lives, 0);
  const frozen = JSON.stringify(game);
  advance(game, 1);
  assert.equal(JSON.stringify(game), frozen);
  restart(game);
  assert.deepEqual(game, playing());
});
test("tab-size deltas are bounded and invalid deltas ignored", () => {
  const game = playing();
  advance(game, 10000);
  assert.ok(game.time > 39.8);
  const snapshot = JSON.stringify(game);
  for (const delta of [NaN, Infinity, -1, 0]) advance(game, delta);
  assert.equal(JSON.stringify(game), snapshot);
});
test("simulation is deterministic across frame partitions", () => {
  const a = playing();
  const b = playing();
  for (let i = 0; i < 120; i++) advance(a, STEP);
  for (let i = 0; i < 60; i++) advance(b, STEP * 2);
  assert.deepEqual(a, b);
});
test("events drain once, not duplicate sounds or goals", () => {
  const game = playing();
  deliver(game, 2);
  assert.ok(drainEvents(game).some(e => e.type === "goal"));
  assert.deepEqual(drainEvents(game), []);
});
test("all five gardens have surviving routes at initial and capped difficulty", () => {
  for (const round of [1, 7]) {
    const game = playing();
    if (round > 1) {
      game.round = round - 1;
      GOALS.forEach((_, i) => deliver(game, i));
      game.score = 0;
    }
    for (let goal = 0; goal < 5; goal++) {
      run(game, 1.8);
      const actions = planRoute(game, goal);
      assert.ok(actions.length * .16 < DEADLINE);
      for (const direction of actions) {
        if (direction !== "wait") hop(game, direction);
        for (let i = 0; i < 10; i++) advance(game, .016);
        assert.equal(game.lives, 3);
      }
      if (goal < 4) assert.equal(game.goals[goal], true);
    }
    assert.equal(game.round, round + 1);
  }
});
