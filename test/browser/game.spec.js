import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { planRoute as plan } from "../helpers/route.js";
import path from "node:path";

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'";
const snapshot = page => page.evaluate(async () => {
  const { getGameSnapshot } = await import("./src/app.js");
  return getGameSnapshot();
});
const keyFor = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
const CLOCK_START = Date.UTC(2026, 0, 1);
async function open(page) {
  await page.clock.install({ time: CLOCK_START });
  await page.clock.pauseAt(CLOCK_START + 2000);
  await page.goto("./");
  await page.evaluate(() => document.fonts.ready);
}
async function step(page, direction, ms = 160) {
  if (direction !== "wait") await page.keyboard.press(keyFor[direction]);
  await page.clock.runFor(ms);
}
async function capture(page, name) {
  if (process.env.CAPTURE_DIR) {
    await page.screenshot({ path: path.join(process.env.CAPTURE_DIR, name), fullPage: true });
  }
}
// Collects CSP violation events from every frame of the page, plus Chrome's console reports of them.
async function watchCsp(page) {
  const reports = [];
  page.on("console", message => { if (message.text().includes("Content Security Policy")) reports.push(message.text()); });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", event => window.__cspViolations.push(
      `${event.violatedDirective} blocked ${event.blockedURI || "inline"} at ${event.sourceFile}:${event.lineNumber}`));
  });
  return reports;
}
const cspViolations = frame => frame.evaluate(() => window.__cspViolations);
// The cabinet iframe paints its Start button before src/app.js has evaluated, so a click can land before the
// controller is listening. Resolves the game frame once the module graph is loaded and reports ready.
async function booted(page) {
  await expect(page.frameLocator("iframe").locator("#start")).toBeVisible();
  const frame = page.frames().find(frame => frame.parentFrame());
  expect((await snapshot(frame)).status).toBe("ready");
  return frame;
}
// The harness document has no policy of its own; only the game inside the iframe runs under index.html's CSP.
async function embed(page) {
  await page.goto("./styles.css");
  await page.setContent('<iframe title="Mona Crossing" style="width:800px;height:1100px" sandbox="allow-scripts allow-same-origin allow-pointer-lock" allow="fullscreen; gamepad"></iframe>');
  await page.locator("iframe").evaluate((frame, url) => { frame.src = url; }, test.info().project.use.baseURL);
  const frame = await booted(page);
  await frame.evaluate(() => document.fonts.ready);
  return { game: page.frameLocator("iframe"), frame };
}
// Drives the real controls through every UI state and runs `check(state)` in each one.
async function eachState(page, game, frame, check) {
  await expect(game.getByRole("button", { name: "Start crossing" })).toBeVisible();
  await check("ready");
  await game.locator("#start").click();
  await page.clock.runFor(500);
  await expect(game.locator("#overlay")).toBeHidden();
  await check("playing");
  await game.locator("#pause").click();
  await expect(game.getByRole("button", { name: "Resume crossing" })).toBeVisible();
  await check("paused");
  await game.getByText("How to cross", { exact: true }).click();
  await expect(game.locator(".instructions-body")).toBeVisible();
  await check("instructions");
  await game.locator("#start").click();
  await page.clock.runFor(32);
  // Blind upward hops lose the three hearts; the 40-second deadline alone ends the game within the bound.
  await page.keyboard.down("ArrowUp");
  for (let i = 0; i < 40 && (await snapshot(frame)).status !== "over"; i++) await page.clock.runFor(4000);
  await page.keyboard.up("ArrowUp");
  await expect(game.getByRole("button", { name: "Play again" })).toBeVisible();
  await check("over");
}
// Every axe-core finding, whatever its impact; `embedded` scopes the run to the cabinet iframe's document.
// axe resolves every rule through setTimeout(0), so the fake clock has to flow while it scans.
async function accessibilityViolations(page, embedded = false) {
  const builder = new AxeBuilder({ page });
  if (embedded) builder.include(["iframe", "html"]);
  await page.clock.resume();
  try {
    const { violations } = await builder.analyze();
    return violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(node => node.target.join(" ")) }));
  } finally {
    await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
  }
}

test("keyboard play delivers five gardens, carries, pauses, replays and saves", async ({ page }) => {
  const errors = [];
  const requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  await open(page);
  await expect(page.getByRole("button", { name: "Start crossing" })).toBeVisible();
  await capture(page, "desktop-start.png");
  await page.getByRole("button", { name: "Start crossing" }).click();
  await page.clock.runFor(32);
  await expect(page.locator("#game")).toBeFocused();
  await page.keyboard.press("a");
  await page.clock.runFor(160);
  await page.keyboard.press("d");
  await page.clock.runFor(160);
  await page.keyboard.press("p");
  const paused = await snapshot(page);
  await page.clock.runFor(3000);
  expect((await snapshot(page)).time).toBe(paused.time);
  await page.getByRole("button", { name: "Resume crossing" }).click();
  await page.clock.runFor(32);
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await page.clock.runFor(32);
  let carried = false;
  let captured = false;
  for (let goal = 0; goal < 5; goal++) {
    await page.clock.runFor(1800);
    let route = plan(await snapshot(page), goal);
    for (let i = 0; i < route.length; i++) {
      const direction = route[i];
      const before = await snapshot(page);
      await step(page, direction);
      const after = await snapshot(page);
      expect(after.lives).toBe(3);
      if (after.player.row >= 1 && after.player.row <= 3) {
        const x = after.player.x;
        await page.clock.runFor(160);
        const resting = await snapshot(page);
        expect(resting.lives).toBe(3);
        if (resting.player.row === after.player.row && resting.player.x !== x) carried = true;
        // Re-plan after observation time so the input route follows the moving river.
        const fresh = plan(resting, goal);
        route = [...route.slice(0, i + 1), ...fresh];
      }
      if (!captured && before.player.row === 4 && after.player.row === 3) {
        await capture(page, "desktop-gameplay.png");
        if (process.env.CAPTURE_DIR) {
          await page.locator("#game").screenshot({ path: path.join(process.env.CAPTURE_DIR, "gameplay.png") });
        }
        captured = true;
      }
      if (after.goals[goal] || after.round > 1) break;
    }
    if (goal < 4) expect((await snapshot(page)).goals[goal]).toBe(true);
  }
  expect(carried).toBe(true);
  expect((await snapshot(page)).round).toBe(2);
  await expect(page.locator("#feedback")).toContainText("All five home");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Resume crossing" })).toBeVisible();
  await page.keyboard.press("m");
  await expect(page.locator("#sound")).toHaveText("Sound: on");
  await page.keyboard.press("m");
  await expect(page.locator("#sound")).toHaveText("Sound: off");
  const best = (await snapshot(page)).score;
  await page.reload();
  await expect(page.locator("#best")).toHaveText(String(best).padStart(5, "0"));
  expect(errors).toEqual([]);
  expect(requests.every(url => url.startsWith(new URL(page.url()).origin))).toBe(true);
});

test("real failures give useful game over and instant replay; blur pauses", async ({ page }) => {
  await open(page);
  await page.locator("#start").click();
  await page.clock.runFor(32);
  // The initial leftmost bug crosses the central route; holding up loses a heart.
  await page.keyboard.down("ArrowUp");
  await page.clock.runFor(8000);
  await page.keyboard.up("ArrowUp");
  expect((await snapshot(page)).lives).toBeLessThan(3);
  for (let i = 0; i < 3 && (await snapshot(page)).status !== "over"; i++) {
    await page.clock.runFor(42000);
  }
  await expect(page.getByRole("button", { name: "Play again" })).toBeVisible();
  await expect(page.locator("#feedback")).toContainText("Final score");
  await page.getByRole("button", { name: "Play again" }).click();
  await page.clock.runFor(32);
  expect((await snapshot(page)).lives).toBe(3);
  expect((await snapshot(page)).score).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  expect((await snapshot(page)).status).toBe("paused");
});

test("phone touch play at 390 and 320; landscape, help and menu keys stay usable", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.clock.install({ time: CLOCK_START });
  await page.clock.pauseAt(CLOCK_START + 2000);
  await page.goto(process.env.GAME_URL || "http://127.0.0.1:4177/mona-crossing/");
  await page.evaluate(() => document.fonts.ready);
  await capture(page, "mobile-start.png");
  await page.locator("#start").tap();
  await page.clock.runFor(32);
  const originalX = (await snapshot(page)).player.x;
  await page.getByRole("button", { name: "Hop left" }).tap();
  await page.clock.runFor(160);
  expect((await snapshot(page)).player.x).toBe(originalX - 32);
  await page.getByRole("button", { name: "Hop right" }).tap();
  await page.clock.runFor(160);
  expect((await snapshot(page)).player.x).toBe(originalX);
  const route = plan(await snapshot(page), 0);
  for (const direction of route) {
    if (direction !== "wait") await page.getByRole("button", { name: `Hop ${direction}` }).tap();
    await page.clock.runFor(160);
    expect((await snapshot(page)).lives).toBe(3);
  }
  expect((await snapshot(page)).goals[0]).toBe(true);
  await capture(page, "mobile-gameplay.png");
  for (const size of [{ width: 320, height: 720 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const name of ["Sound: off", "Relaxed timer: off", "Restart", "Hop up", "Hop down"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(page.locator("#pause")).toBeVisible();
    if (size.width === 320) await capture(page, "mobile-320.png");
  }
  await page.locator("#pause").tap();
  expect((await snapshot(page)).status).toBe("paused");
  await page.locator("#sound").focus();
  await page.keyboard.press("ArrowUp");
  expect((await snapshot(page)).status).toBe("paused");
  await page.getByText("How to cross", { exact: true }).tap();
  await expect(page.locator(".instructions-body")).toBeVisible();
  await context.close();
});

test("cabinet sandbox focuses inputs; denied saves and audio are nonfatal", async ({ page }) => {
  const { game } = await embed(page);
  await expect(game.getByRole("link", { name: "GitHub Arcade", includeHidden: true })).toBeHidden();
  await expect(game.locator("#source-link")).toBeHidden();
  await game.getByRole("button", { name: "Start crossing" }).click();
  await expect(game.locator("#game")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("p");
  await expect(game.getByRole("button", { name: "Resume crossing" })).toBeVisible();
  await capture(page, "arcade-cabinet-desktop.png");
  await page.goto("./");
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new Error("Test denied storage"); } });
    Object.defineProperty(window, "AudioContext", { value: undefined });
    Object.defineProperty(window, "webkitAudioContext", { value: undefined });
  });
  await page.reload();
  await expect(page.locator("#notice")).toContainText("storage");
  await page.locator("#sound").click();
  await expect(page.locator("#notice")).toContainText("Sound could not start");
  await page.locator("#start").click();
  await expect(page.locator("#overlay")).toBeHidden();
});

test("standalone arcade link is focusable without starting or resuming play", async ({ page }) => {
  await open(page);
  const arcade = page.getByRole("link", { name: "GitHub Arcade", exact: true });
  await expect(arcade).toBeVisible();
  await expect(arcade).toHaveAttribute("href", "https://jdooley-clt.github.io/arcade/");
  expect(await arcade.getAttribute("target")).toBeNull();
  await page.getByRole("link", { name: "Source & credits" }).focus();
  await page.keyboard.press("Tab");
  await expect(arcade).toBeFocused();
  const ready = await snapshot(page);
  for (const key of ["ArrowUp", "w", "p", "m", "t", " "]) await page.keyboard.press(key);
  expect(await snapshot(page)).toEqual(ready);
  await expect(page.locator("#sound")).toHaveText("Sound: off");
  await expect(page.locator("#timer-mode")).toHaveText("Relaxed timer: off");
  await capture(page, "arcade-desktop-focus.png");
  await page.locator("#start").click();
  await page.locator("#pause").click();
  await arcade.focus();
  await page.keyboard.press("p");
  expect((await snapshot(page)).status).toBe("paused");
});

test("relaxed timer lifts the deadline and persists; letter keys only act on the focused playfield", async ({ page }) => {
  await open(page);
  const toggle = page.locator("#timer-mode");
  const time = page.locator("#time");
  await expect(toggle).toHaveText("Relaxed timer: off");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(time).toHaveText("40");
  // With focus on the page body, typing letters must not flip settings or move Mona; Enter still starts.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.keyboard.press("t");
  await page.keyboard.press("m");
  await expect(toggle).toHaveText("Relaxed timer: off");
  await expect(page.locator("#sound")).toHaveText("Sound: off");
  expect((await snapshot(page)).status).toBe("ready");
  await page.keyboard.press("Enter");
  await expect(page.locator("#game")).toBeFocused();
  await page.keyboard.press("t");
  await expect(toggle).toHaveText("Relaxed timer: on");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(time).toHaveText("∞");
  await expect(time).toHaveAttribute("aria-label", "No time limit");
  await expect(page.locator("#feedback")).toContainText("Relaxed timer on");
  await page.clock.runFor(45000);
  expect(await snapshot(page)).toMatchObject({ status: "playing", lives: 3, time: 40, relaxed: true });
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("p");
  await page.clock.runFor(160);
  expect(await snapshot(page)).toMatchObject({ status: "playing", player: { row: 10 } });
  await page.keyboard.press("Escape");
  expect((await snapshot(page)).status).toBe("paused");
  await page.locator("#start").click();
  await page.keyboard.press("t");
  await expect(toggle).toHaveText("Relaxed timer: off");
  await expect(time).toHaveText("40");
  expect(await time.getAttribute("aria-label")).toBeNull();
  await page.clock.runFor(2000);
  expect((await snapshot(page)).time).toBeLessThan(40);
  await toggle.click();
  await expect(toggle).toHaveText("Relaxed timer: on");
  await page.keyboard.press("t");
  await expect(toggle).toHaveText("Relaxed timer: on");
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("mona-crossing:v1")))).toMatchObject({ relaxed: true });
  await page.reload();
  await expect(toggle).toHaveText("Relaxed timer: on");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(time).toHaveText("∞");
  expect((await snapshot(page)).relaxed).toBe(true);
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new Error("Test denied storage"); } });
  });
  await page.reload();
  await expect(page.locator("#notice")).toContainText("storage");
  await expect(toggle).toHaveText("Relaxed timer: off");
  await toggle.click();
  await expect(toggle).toHaveText("Relaxed timer: on");
  await expect(time).toHaveText("∞");
  expect((await snapshot(page)).relaxed).toBe(true);
});

test("arcade footer and cabinet controls fit 390 and 320 touch viewports", async ({ browser }) => {
  for (const width of [390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await open(page);
    const arcade = page.getByRole("link", { name: "GitHub Arcade", exact: true });
    await expect(arcade).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, `arcade-mobile-${width}.png`);
    await page.goto("./styles.css");
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}iframe{display:block;width:100%;height:850px;border:0}</style><iframe title="Mona Crossing" sandbox="allow-scripts allow-same-origin allow-pointer-lock" allow="fullscreen; gamepad"></iframe>');
    await page.locator("iframe").evaluate((frame, url) => { frame.src = url; }, test.info().project.use.baseURL);
    const game = page.frameLocator("iframe");
    const frame = await booted(page);
    await expect(game.locator("#arcade-link")).toBeHidden();
    await expect(game.locator("#source-link")).toBeHidden();
    await game.locator("#start").tap();
    expect(await frame.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height: 850 });
    const before = await snapshot(frame);
    await game.getByRole("button", { name: "Hop left" }).tap();
    await page.clock.runFor(160);
    expect((await snapshot(frame)).player.x).toBe(before.player.x - 32);
    await game.locator("#pause").tap();
    expect((await snapshot(frame)).status).toBe("paused");
    await game.locator("#sound").tap();
    await expect(game.locator("#sound")).toHaveText("Sound: on");
    await game.locator("#sound").tap();
    await game.getByText("How to cross", { exact: true }).tap();
    await expect(game.locator(".instructions-body")).toBeVisible();
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await game.locator("footer").scrollIntoViewIfNeeded();
    await expect(game.locator("#source-link")).toBeHidden();
    await capture(page, `arcade-cabinet-${width}-help.png`);
    await context.close();
  }
});

test("the Content Security Policy is enforced with zero violations standalone and inside the cabinet", async ({ page }) => {
  const reports = await watchCsp(page);
  await open(page);
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content")).toBe(CSP);
  expect(await page.locator('meta[name="referrer"]').getAttribute("content")).toBe("strict-origin-when-cross-origin");
  await page.locator("#sound").click();
  await expect(page.locator("#sound")).toHaveText("Sound: on");
  await page.locator("#start").click();
  await page.clock.runFor(32);
  await page.keyboard.press("ArrowUp");
  await page.clock.runFor(160);
  await page.locator("#pause").click();
  await page.getByText("How to cross", { exact: true }).click();
  await expect(page.locator(".instructions-body")).toBeVisible();
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await page.clock.runFor(1000);
  expect((await snapshot(page)).status).toBe("playing");
  await page.locator("#sound").click();
  expect(await cspViolations(page)).toEqual([]);

  const { game, frame } = await embed(page);
  await game.locator("#start").click();
  await page.clock.runFor(32);
  await page.keyboard.press("ArrowUp");
  await page.clock.runFor(160);
  await game.locator("#pause").click();
  expect((await snapshot(frame)).status).toBe("paused");
  expect(await cspViolations(frame)).toEqual([]);
  expect(reports).toEqual([]);
});

test("axe-core finds no issue of any impact in any game state, standalone or inside the cabinet", async ({ page }) => {
  test.setTimeout(240000);
  const canary = '<button id="axe-canary" type="button"></button>';
  await open(page);
  await eachState(page, page, page, async state => {
    expect(await accessibilityViolations(page), `standalone ${state}`).toEqual([]);
  });
  // An unlabeled control must trip the gate, proving the scan is not vacuous.
  await page.evaluate(html => document.body.insertAdjacentHTML("beforeend", html), canary);
  expect(await accessibilityViolations(page)).toEqual([{ id: "button-name", impact: "critical", targets: ["#axe-canary"] }]);

  const { game, frame } = await embed(page);
  await eachState(page, game, frame, async state => {
    expect(await accessibilityViolations(page, true), `cabinet ${state}`).toEqual([]);
  });
  await frame.evaluate(html => document.body.insertAdjacentHTML("beforeend", html), canary);
  expect(await accessibilityViolations(page, true)).toEqual([
    { id: "button-name", impact: "critical", targets: [expect.stringMatching(/^iframe.* #axe-canary$/)] }
  ]);
});