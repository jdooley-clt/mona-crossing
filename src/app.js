import { createGame, start, restart, hop, advance, togglePause, pause, drainEvents, DEADLINE } from "./simulation.js";
import { createRenderer } from "./renderer.js";
import { createStorage } from "./storage.js";
import { createAudio } from "./audio.js";

const $ = id => document.getElementById(id);
const canvas = $("game");
$("source-link").hidden = window.self !== window.top;
$("arcade-link").hidden = window.self !== window.top;
const noticeMessages = new Set();
function report(message) {
  noticeMessages.add(message);
  $("notice").textContent = [...noticeMessages].join(" ");
  $("notice").hidden = false;
}

let storage;
try { storage = window.localStorage; }
catch (error) {
  console.warn("Mona Crossing storage access denied:", error);
  report("Site storage is blocked. Best score and sound preference last only this visit.");
}
const saves = createStorage(storage, report);
const settings = saves.load();
const audio = createAudio(report);
const game = createGame();
export function getGameSnapshot() {
  return structuredClone(game);
}
let renderer;
try {
  renderer = createRenderer(canvas, { reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches });
} catch (error) {
  console.error(error);
  report(error.message);
  $("start").disabled = true;
  $("restart").disabled = true;
}
let lastFrame = 0;
let lastStatus = "";
let lastHud = "";
let feedback = "Five gardens. One brave Octocat.";
let soundRequest = 0;
let held = null;
let heldTime = 0;
const reasons = {
  traffic: "A bug caught you! Wait for a clear gap.",
  river: "Splash! Land fully on a log or PR ferry.",
  bank: "Swept off the bank! Hop before the edge.",
  deadline: "Time ran out! Try a quicker crossing.",
  occupied: "That garden is full! Pick an empty main.",
  garden: "Find a main garden, not the hedge!"
};

function save() { saves.save({ best: settings.best, sound: settings.sound }); }
function updateSound() {
  $("sound").textContent = `Sound: ${settings.sound ? "on" : "off"}`;
  $("sound").setAttribute("aria-pressed", String(settings.sound));
}
async function unlockSound() {
  const request = ++soundRequest;
  const wanted = settings.sound;
  const ok = await audio.unlock(wanted);
  if (request !== soundRequest) return;
  if (!ok && wanted) { settings.sound = false; save(); updateSound(); }
}
function focusGame() { canvas.focus({ preventScroll: true }); }
function clearHeld() { held = null; heldTime = 0; }
function playAgain() {
  restart(game);
  clearHeld();
  lastFrame = 0;
  feedback = "Find a gap. The cream sidewalk is safe.";
  unlockSound();
  focusGame();
  sync();
}
function activate() {
  if (game.status === "paused") togglePause(game);
  else start(game);
  lastFrame = 0;
  unlockSound();
  focusGame();
  sync();
}
function pauseGame() {
  togglePause(game);
  clearHeld();
  lastFrame = 0;
  sync();
}
function move(direction) {
  if (game.status === "ready" || game.status === "over") return;
  hop(game, direction);
  sync();
}
function sync() {
  for (const event of drainEvents(game)) {
    renderer?.event(event, game.elapsed);
    audio.play(event.type);
    if (event.type === "death") feedback = reasons[event.reason];
    if (event.type === "goal") feedback = `Garden ${event.index + 1} delivered! ${event.count}/5 home. +${event.bonus}`;
    if (event.type === "round") feedback = `All five home! +500. Welcome to round ${game.round}.`;
    if (event.type === "pause") feedback = "Paused. Your crossing will wait.";
    if (event.type === "resume") feedback = "Back to the neighborhood. Hop when you're ready.";
    if (event.type === "over") feedback = `${feedback} Final score: ${game.score}.`;
  }
  if (game.score > settings.best) { settings.best = game.score; save(); }
  const hud = [game.score, settings.best, game.lives, Math.ceil(game.time), game.round].join();
  if (hud !== lastHud) {
    $("score").textContent = String(game.score).padStart(5, "0");
    $("best").textContent = String(settings.best).padStart(5, "0");
    $("hearts").textContent = `${game.lives} / 3`;
    $("hearts").setAttribute("aria-label", `${game.lives} hearts`);
    $("time").textContent = String(Math.ceil(game.time)).padStart(2, "0");
    $("round").textContent = String(game.round).padStart(2, "0");
    lastHud = hud;
  }
  $("time-bar").style.width = `${game.time / DEADLINE * 100}%`;
  if ($("feedback").textContent !== feedback) $("feedback").textContent = feedback;
  if (lastStatus !== game.status) {
    $("overlay").hidden = game.status === "playing";
    $("pause").disabled = game.status === "ready" || game.status === "over";
    $("pause").innerHTML = game.status === "paused" ? "Resume <kbd>P</kbd>" : "Pause <kbd>P</kbd>";
    const states = {
      ready: ["Welcome to the neighborhood!", "Dodge the bugs. Ride the commits.\nGet Mona to all five main gardens.", "Start crossing"],
      paused: ["A little breather.", "Your hearts and timer are safe.\nResume whenever you're ready.", "Resume crossing"],
      over: ["That's a wrap!", `You scored ${game.score}. Your best is ${settings.best}.\nFresh hearts. Another little adventure?`, "Play again"]
    };
    const state = states[game.status];
    if (state) {
      $("overlay-title").textContent = state[0];
      $("overlay-copy").textContent = state[1];
      $("start").textContent = state[2];
    }
    lastStatus = game.status;
  }
  renderer?.draw(game);
}

$("start").addEventListener("click", activate);
$("restart").addEventListener("click", playAgain);
$("pause").addEventListener("click", () => { pauseGame(); focusGame(); });
$("sound").addEventListener("click", () => {
  settings.sound = !settings.sound;
  updateSound();
  save();
  unlockSound();
});
canvas.addEventListener("pointerdown", () => { focusGame(); unlockSound(); });

const directions = {
  ArrowUp: "up", w: "up", ArrowDown: "down", s: "down",
  ArrowLeft: "left", a: "left", ArrowRight: "right", d: "right"
};
window.addEventListener("keydown", event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (target instanceof Element && target.closest("button, a, summary, input, textarea, select, [contenteditable]")) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const direction = directions[key];
  if (direction) {
    event.preventDefault();
    if (!event.repeat) { held = { direction, source: key }; heldTime = .2; move(direction); }
    return;
  }
  if (key === "p" || key === "Escape") { event.preventDefault(); if (!event.repeat) pauseGame(); }
  if (key === "m" && !event.repeat) $("sound").click();
  if (key === "Enter" && !event.repeat && game.status !== "playing") activate();
});
window.addEventListener("keyup", event => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (held?.source === key) clearHeld();
});
for (const button of document.querySelectorAll("[data-direction]")) {
  button.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    focusGame();
    unlockSound();
    button.setPointerCapture(event.pointerId);
    held = { direction: button.dataset.direction, source: event.pointerId };
    heldTime = .2;
    move(held.direction);
  });
  button.addEventListener("pointerup", clearHeld);
  button.addEventListener("pointercancel", clearHeld);
  button.addEventListener("lostpointercapture", clearHeld);
  button.addEventListener("click", event => {
    if (event.detail === 0) { move(button.dataset.direction); }
  });
}
function leave() {
  clearHeld();
  pause(game);
  lastFrame = 0;
  sync();
}
window.addEventListener("blur", leave);
document.addEventListener("visibilitychange", () => { if (document.hidden) leave(); });

function frame(timestamp) {
  const dt = lastFrame ? Math.min((timestamp - lastFrame) / 1000, .1) : 0;
  lastFrame = timestamp;
  advance(game, dt);
  if (game.status === "playing" && held) {
    heldTime -= dt;
    if (heldTime <= 0) { move(held.direction); heldTime = .16; }
  }
  sync();
  requestAnimationFrame(frame);
}
updateSound();
sync();
if (renderer) requestAnimationFrame(frame);
