import { test, expect } from "@playwright/test";
import { planRoute as plan } from "../helpers/route.js";
import path from "node:path";

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
    for (const name of ["Sound: off", "Restart", "Hop up", "Hop down"]) {
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
  await page.goto("./styles.css");
  await page.setContent('<iframe title="Mona Crossing" style="width:800px;height:1100px" sandbox="allow-scripts allow-same-origin allow-pointer-lock" allow="fullscreen; gamepad"></iframe>');
  await page.locator("iframe").evaluate((frame, url) => { frame.src = url; }, test.info().project.use.baseURL);
  const game = page.frameLocator("iframe");
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
  for (const key of ["ArrowUp", "w", "p", "m", " "]) await page.keyboard.press(key);
  expect(await snapshot(page)).toEqual(ready);
  await expect(page.locator("#sound")).toHaveText("Sound: off");
  await capture(page, "arcade-desktop-focus.png");
  await page.locator("#start").click();
  await page.locator("#pause").click();
  await arcade.focus();
  await page.keyboard.press("p");
  expect((await snapshot(page)).status).toBe("paused");
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
    await expect(game.locator("#arcade-link")).toBeHidden();
    await expect(game.locator("#source-link")).toBeHidden();
    await game.locator("#start").tap();
    const frame = page.frames().find(frame => frame.parentFrame());
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
