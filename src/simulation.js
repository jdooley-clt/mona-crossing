export const CELL = 32;
export const COLS = 15;
export const WIDTH = CELL * COLS;
export const SPAWN_ROW = 10;
export const GOALS = [1, 4, 7, 10, 13];
export const GOAL_WIDTH = CELL * 2;
export const DEADLINE = 40;
export const HOP_COOLDOWN = 0.14;
export const STEP = 1 / 120;
export const PLAYER_HALF = 10;
const SUPPORT_EPSILON = 1e-7;

const laneSpecs = [
  { row: 1, kind: "log", speed: 14, length: 224, gap: 32, offset: 4 },
  { row: 2, kind: "ferry", speed: -16, length: 240, gap: 32, offset: 24 },
  { row: 3, kind: "log", speed: 12, length: 224, gap: 32, offset: 14 },
  { row: 5, kind: "bug", speed: -43, length: 40, gap: 105, offset: 25 },
  { row: 6, kind: "conflict", speed: 39, length: 59, gap: 125, offset: 65 },
  { row: 8, kind: "bug", speed: -45, length: 42, gap: 123, offset: 5 },
  { row: 9, kind: "bug", speed: 35, length: 40, gap: 128, offset: 28 }
];

export function createGame({ relaxed = false } = {}) {
  const game = {
    status: "ready", score: 0, lives: 3, round: 1, time: DEADLINE, relaxed: relaxed === true,
    goals: GOALS.map(() => false), cooldown: 0, transition: 0,
    player: { x: WIDTH / 2, row: SPAWN_ROW }, furthest: SPAWN_ROW,
    lanes: [], events: [], elapsed: 0, remainder: 0
  };
  resetLanes(game);
  return game;
}

// The relaxed timer removes the crossing deadline (WCAG 2.2.1 Timing Adjustable). It never refills the
// clock, so toggling it mid-crossing cannot be used to buy time or bonus in the standard mode.
export function setRelaxed(game, relaxed) {
  game.relaxed = relaxed === true;
}

function resetLanes(game) {
  const multiplier = 1 + Math.min(game.round - 1, 6) * 0.085;
  game.lanes = laneSpecs.map(lane => ({
    ...lane, speed: lane.speed * multiplier,
    period: lane.length + lane.gap, phase: lane.offset
  }));
}

function respawn(game) {
  game.player = { x: WIDTH / 2, row: SPAWN_ROW };
  game.time = DEADLINE;
  game.furthest = SPAWN_ROW;
  game.cooldown = HOP_COOLDOWN;
}

export function restart(game) {
  Object.assign(game, createGame({ relaxed: game.relaxed }), { status: "playing" });
}

export function start(game) {
  if (game.status === "ready" || game.status === "over") restart(game);
}

export function togglePause(game) {
  if (game.status === "playing") {
    game.status = "paused";
    game.events.push({ type: "pause" });
  } else if (game.status === "paused") {
    game.status = "playing";
    game.events.push({ type: "resume" });
  }
}

export function pause(game) {
  if (game.status === "playing") togglePause(game);
}

export function segments(lane) {
  const start = ((lane.phase % lane.period) + lane.period) % lane.period;
  const result = [];
  for (let x = start - lane.period; x < WIDTH; x += lane.period) {
    if (x + lane.length > 0) result.push({ x, width: lane.length });
  }
  return result;
}

export function platformAt(lane, x) {
  // Carry and wrapped phase accumulate rounding independently at deck edges.
  return segments(lane).find(segment =>
    x - PLAYER_HALF >= segment.x - SUPPORT_EPSILON &&
    x + PLAYER_HALF <= segment.x + segment.width + SUPPORT_EPSILON
  );
}

function fail(game, reason) {
  if (game.status !== "playing" || game.transition > 0) return;
  game.lives--;
  game.events.push({ type: "death", reason, lives: game.lives });
  respawn(game);
  if (game.lives === 0) {
    game.status = "over";
    game.events.push({ type: "over", score: game.score });
  } else {
    game.transition = 0.65;
  }
}

function collide(game) {
  if (game.player.x - PLAYER_HALF < 0 || game.player.x + PLAYER_HALF > WIDTH) {
    fail(game, "bank");
    return;
  }
  const lane = game.lanes.find(item => item.row === game.player.row);
  if (!lane) return;
  if (lane.kind === "log" || lane.kind === "ferry") {
    if (!platformAt(lane, game.player.x)) fail(game, "river");
  } else if (segments(lane).some(segment =>
    game.player.x + PLAYER_HALF > segment.x + 3 &&
    game.player.x - PLAYER_HALF < segment.x + segment.width - 3
  )) {
    fail(game, "traffic");
  }
}

export function hop(game, direction) {
  if (game.status !== "playing" || game.transition > 0 || game.cooldown > 0) return false;
  const vector = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
  if (!vector) return false;
  const [dx, dy] = vector;
  const x = game.player.x + dx * CELL;
  const row = game.player.row + dy;
  if (x < CELL / 2 || x > WIDTH - CELL / 2 || row < 0 || row > SPAWN_ROW) return false;
  game.player.x = x;
  game.player.row = row;
  game.cooldown = HOP_COOLDOWN;
  game.events.push({ type: "hop" });
  if (row === 0) {
    const goalIndex = GOALS.findIndex(col => {
      const left = (col + .5) * CELL - GOAL_WIDTH / 2;
      return x >= left && x < left + GOAL_WIDTH;
    });
    if (goalIndex < 0 || game.goals[goalIndex]) {
      fail(game, goalIndex < 0 ? "garden" : "occupied");
      return true;
    }
    game.goals[goalIndex] = true;
    // The quick-arrival bonus needs a running clock; the relaxed timer pays the base reward only.
    const bonus = game.relaxed ? 100 : 100 + Math.ceil(game.time) * 5;
    game.score += bonus;
    game.events.push({ type: "goal", index: goalIndex, bonus, count: game.goals.filter(Boolean).length });
    respawn(game);
    game.transition = 0.75;
    if (game.goals.every(Boolean)) {
      game.score += 500;
      game.events.push({ type: "round", round: game.round, bonus: 500 });
      game.round++;
      game.goals.fill(false);
      resetLanes(game);
      game.transition = 1.6;
    }
    return true;
  }
  collide(game);
  if (game.transition === 0 && game.status === "playing" && row < game.furthest) {
    game.score += (game.furthest - row) * 10;
    game.furthest = row;
  }
  return true;
}

function tick(game, dt) {
  game.elapsed += dt;
  game.cooldown = Math.max(0, game.cooldown - dt);
  const resting = game.transition > 0;
  if (resting) game.transition = Math.max(0, game.transition - dt);
  const lane = game.lanes.find(item => item.row === game.player.row);
  const support = !resting && lane && (lane.kind === "log" || lane.kind === "ferry")
    ? platformAt(lane, game.player.x) : null;
  for (const item of game.lanes) {
    item.phase = ((item.phase + item.speed * dt) % item.period + item.period) % item.period;
  }
  if (resting) return;
  if (support) game.player.x += lane.speed * dt;
  if (!game.relaxed) game.time = Math.max(0, game.time - dt);
  if (game.time === 0) fail(game, "deadline");
  else collide(game);
}

// Bounded substeps keep the fastest vehicle below one pixel of travel per step.
// Excess wall time is deliberately dropped; the controller pauses on tab/blur.
export function advance(game, seconds) {
  if (game.status !== "playing" || !Number.isFinite(seconds) || seconds <= 0) return;
  game.remainder += Math.min(seconds, 0.1);
  while (game.remainder + 1e-10 >= STEP && game.status === "playing") {
    game.remainder = Math.max(0, game.remainder - STEP);
    tick(game, STEP);
  }
}

export function drainEvents(game) {
  return game.events.splice(0);
}
