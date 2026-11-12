import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, access, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createPreviewServer } from "../scripts/serve.mjs";
import { createStorage } from "../src/storage.js";

// What scripts/build.mjs stages into dist/ (plus an empty .nojekyll marker), measured with LF line endings.
// Raise both numbers deliberately, in the same change that grows the payload; the gate trips at +10%.
const STAGED = ["index.html", "styles.css", "src", "assets"];
const BUDGET = { raw: 100_463, gzip: 42_903 };
const TEXT = /\.(?:html|css|m?js|svg|txt|md)$/i;

test("all entry references exist and remain relative", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.equal(html.includes("</+h2>"), false);
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) {
    await access(new URL(`../${match[1]}`, import.meta.url));
  }
  assert.match(html, /aria-label="Movement controls"/);
  assert.match(html, /role="status"/);
  assert.match(html, /<button id="timer-mode" type="button" aria-pressed="false">Relaxed timer: off<\/button>/);
  assert.match(html, /<output id="time" aria-live="off">/);
  assert.equal((html.match(/<canvas /g) || []).length, 1);
  assert.doesNotMatch(html, /https?:\/\/[^"]+\.(?:js|css|ttf)/);
  const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  assert.match(renderer, /M3 0h4v2h14V0h4v8/);
  const cover = await readFile(new URL("../assets/mona-crossing-cover.svg", import.meta.url), "utf8");
  assert.match(cover, /viewBox="0 0 640 360"/);
  assert.doesNotMatch(cover, /<script|<image|https?:\/\/(?!www\.w3\.org)/);
  const png = await readFile(new URL("../assets/mona-crossing-gameplay.png", import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
});
test("standalone and repository arcade links preserve play and credits links", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(html, /<a id="arcade-link" href="https:\/\/jdooley-clt\.github\.io\/arcade\/" hidden>GitHub Arcade<\/a>/);
  assert.match(html, /<a id="source-link" href="https:\/\/github\.com\/jdooley-clt\/mona-crossing" hidden>Source &amp; credits<\/a>/);
  assert.match(readme, /\*\*Play:\*\* https:\/\/jdooley-clt\.github\.io\/mona-crossing\//);
  assert.match(readme, /\[GitHub Arcade\]\(https:\/\/jdooley-clt\.github\.io\/arcade\/\)/);
});
test("the page ships a same-origin Content Security Policy and needs no inline exceptions", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'">/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)|<style[\s>]|\sstyle="|\son[a-z]+="/);
  for (const [anchor] of html.matchAll(/<a\s[^>]*>/g)) {
    if (anchor.includes('target="_blank"')) assert.match(anchor, /rel="[^"]*\bnoopener\b[^"]*"/, anchor);
  }
});
async function stagedBytes() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const totals = { raw: 0, gzip: 0, files: 0 };
  for (const item of STAGED) {
    const target = path.join(root, item);
    const files = (await stat(target)).isDirectory()
      ? (await readdir(target, { recursive: true })).map(name => path.join(target, name))
      : [target];
    for (const file of files) {
      if (!(await stat(file)).isFile()) continue;
      let bytes = await readFile(file);
      if (TEXT.test(file)) bytes = Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"));
      totals.raw += bytes.length;
      totals.gzip += gzipSync(bytes).length;
      totals.files++;
    }
  }
  return totals;
}
test("the staged payload stays within 10% of its recorded raw and gzipped budget", async () => {
  const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  assert.ok(build.includes(JSON.stringify(STAGED).replaceAll(",", ", ")), "scripts/build.mjs stages a different list; update STAGED and BUDGET together");
  const totals = await stagedBytes();
  assert.ok(totals.files >= 12, `only ${totals.files} staged files found`);
  for (const kind of ["raw", "gzip"]) {
    const limit = Math.floor(BUDGET[kind] * 1.1);
    assert.ok(totals[kind] <= limit, `${kind} payload is ${totals[kind]} bytes; the budget allows ${limit} (baseline ${BUDGET[kind]})`);
  }
});
test("storage validates saves and reports denial without interrupting play", t => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const values = new Map();
  const reports = [];
  const store = createStorage({ getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }, m => reports.push(m));
  assert.deepEqual(store.load(), { best: 0, sound: false, relaxed: false });
  store.save({ best: 123, sound: true, relaxed: true });
  assert.deepEqual(store.load(), { best: 123, sound: true, relaxed: true });
  assert.equal(reports.length, 0);
  const denied = createStorage({ getItem() { throw new Error("denied"); } }, m => reports.push(m));
  assert.deepEqual(denied.load(), { best: 0, sound: false, relaxed: false });
  denied.save({ best: 1, sound: false, relaxed: false });
  assert.equal(reports.length, 1);
  assert.equal(warnings.length, 1);
});
test("saves written before the relaxed timer existed load with the standard timer", () => {
  const reports = [];
  const store = createStorage({ getItem: () => '{"best":5,"sound":true}' }, m => reports.push(m));
  assert.deepEqual(store.load(), { best: 5, sound: true, relaxed: false });
  assert.equal(reports.length, 0);
});
test("malformed and invalid saved values get an actionable warning", t => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  for (const raw of ["{", '{"best":-1,"sound":true}', '{"best":1,"sound":"yes"}', '{"best":1,"sound":false,"relaxed":"yes"}']) {
    const reports = [];
    const store = createStorage({ getItem: () => raw }, m => reports.push(m));
    assert.deepEqual(store.load(), { best: 0, sound: false, relaxed: false });
    assert.equal(reports.length, 1);
  }
  assert.equal(warnings.length, 4);
});
test("preview serves project subpath, modules, fonts and rejects non-site files", async t => {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const resource of ["/", "/mona-crossing/", "/mona-crossing/styles.css", "/src/simulation.js", "/assets/fonts/Silkscreen-Regular.ttf"]) {
    const response = await fetch(base + resource);
    assert.equal(response.status, 200, resource);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/.git/config`)).status, 404);
  assert.equal((await fetch(`${base}/%ZZ`)).status, 400);
  assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
});
