import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { createPreviewServer } from "../scripts/serve.mjs";
import { createStorage } from "../src/storage.js";

test("all entry references exist and remain relative", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.equal(html.includes("</+h2>"), false);
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) {
    await access(new URL(`../${match[1]}`, import.meta.url));
  }
  assert.match(html, /aria-label="Movement controls"/);
  assert.match(html, /role="status"/);
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
test("storage validates saves and reports denial without interrupting play", t => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const values = new Map();
  const reports = [];
  const store = createStorage({ getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }, m => reports.push(m));
  assert.deepEqual(store.load(), { best: 0, sound: false });
  store.save({ best: 123, sound: true });
  assert.deepEqual(store.load(), { best: 123, sound: true });
  assert.equal(reports.length, 0);
  const denied = createStorage({ getItem() { throw new Error("denied"); } }, m => reports.push(m));
  assert.deepEqual(denied.load(), { best: 0, sound: false });
  denied.save({ best: 1, sound: false });
  assert.equal(reports.length, 1);
  assert.equal(warnings.length, 1);
});
test("malformed and invalid saved values get an actionable warning", t => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  for (const raw of ["{", '{"best":-1,"sound":true}', '{"best":1,"sound":"yes"}']) {
    const reports = [];
    const store = createStorage({ getItem: () => raw }, m => reports.push(m));
    assert.deepEqual(store.load(), { best: 0, sound: false });
    assert.equal(reports.length, 1);
  }
  assert.equal(warnings.length, 3);
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
