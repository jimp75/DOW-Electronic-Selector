// Reads the technical data sheet (TDS) of every product in products.js and writes docs.js,
// so the selector can search the words inside the data sheets (hardness, shore, durometer, ...).
// Runs in GitHub Actions after refresh.mjs. Needs Chromium (Playwright) and `pdftotext` (poppler-utils) or, failing that, the pdfjs-dist npm package.
// Safety: if most data sheets cannot be read, nothing is written and the previous docs.js stays.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { extractSpecs } from "./specs.mjs";

const PRODUCTS = new URL("../products.js", import.meta.url);
const OUT = new URL("../docs.js", import.meta.url);
const MAX_CHARS = 40000;      // per product
const PARALLEL = 4;
const nk = n => n.replace(/[™®]/g, "").replace(/\\_/g, "_").toLowerCase().replace(/\s+/g, "");   // same key as the page and refresh.mjs

const load = f => { const c = { window: {} }; vm.createContext(c); try { vm.runInContext(fs.readFileSync(f, "utf8"), c); } catch { return null; } return c.window; };
const P = load(PRODUCTS).DOW_DATA.products;
const prev = (load(OUT) || {}).DOW_DOCS?.docs || {};

const tdsListUrl = id => `https://www.dow.com/en-us/search.html#f-dow_prelatedproduct=${id}&tab=Support&cf-dow_contenttype_hierarchy=Technical%20Data%20Sheet`;
const searchUrl = q => `https://www.dow.com/en-us/search.html#q=${encodeURIComponent(q)}`;
const idOf = p => (/\/pdp\.[^/]*\.([0-9a-z]+)\.html/i.exec(p.u || "") || [])[1];
const partOf = p => p.n.replace(/[™®]/g, "").replace(/^\S+\s+/, "");

async function tdsLinks(page, p) {
  const id = idOf(p);
  await page.goto("about:blank");
  await page.goto(id ? tdsListUrl(id) : searchUrl(partOf(p).split(" ").slice(0, 2).join(" ")), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('a[href*="/documents/"][href$=".pdf"], a[href*="/documents/"][href*=".pdf?"]') || /no results|0 results|did not match/i.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href*="/documents/"]')]
    .filter(a => /\.pdf/i.test(a.href)).map(a => ({ t: (a.innerText || "").replace(/\s+/g, " ").trim(), h: a.href.split("?")[0] })));
  const code = (/\b([a-z]{0,3}[ -]?\d[\w-]{2,})\b/i.exec(partOf(p)) || [])[1];
  // English data sheets only, for this product
  let tds = links.filter(l => /technical data sheet|\btds\b/i.test(l.t) && /^[\x00-\x7F™®]*$/.test(l.t));
  if (!id && code) tds = tds.filter(l => l.t.toLowerCase().includes(code.toLowerCase()));
  const seen = new Set(); return tds.filter(l => !seen.has(l.h) && seen.add(l.h)).slice(0, 2);
}

async function pdfjsText(buf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
  let out = ""; for (let i = 1; i <= doc.numPages; i++) { const c = await (await doc.getPage(i)).getTextContent(); out += c.items.map(x => x.str).join(" ") + " "; }
  return out.replace(/\s+/g, " ").trim();
}
async function pdfText(page, href) {
  // dow.com redirects /documents/... to a viewer page; the PDF itself sits under /content/dam/dcc/
  const url = href.replace(/^https:\/\/www\.dow\.com\/documents\//, "/content/dam/dcc/documents/") + "?iframe=true";
  const b64 = await page.evaluate(async u => {
    const r = await fetch(u); if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer()); if (String.fromCharCode(...b.slice(0, 4)) !== "%PDF") return null;
    let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s);
  }, url);
  if (!b64) return null;
  const f = path.join(os.tmpdir(), `tds-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, Buffer.from(b64, "base64"));
  try { return execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", f, "-"], { maxBuffer: 64e6 }).toString().replace(/\s+/g, " ").trim(); }
  catch { return await pdfjsText(fs.readFileSync(f)); }   // pdftotext not installed: use the npm package instead
  finally { fs.unlinkSync(f); }
}

// Use the Google Chrome that GitHub's runners already have; fall back to the Playwright download.
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", viewport: { width: 1400, height: 1000 } });
const docs = {}; let ok = 0, none = [], failed = [];
const queue = [...P];
async function worker() {
  const page = await ctx.newPage();
  // the PDF fetch has to run from a dow.com page
  while (queue.length) {
    const p = queue.shift(); const k = nk(p.n);
    try {
      const links = await tdsLinks(page, p);
      if (!links.length) { none.push(p.n); if (prev[k]) docs[k] = prev[k]; continue; }
      const parts = []; for (const l of links) { const t = await pdfText(page, l.h); if (t) parts.push(t); }
      if (!parts.length) throw new Error("PDF could not be read");
      const text = parts.join(" ");
      docs[k] = { pdf: links[0].h, s: extractSpecs(text), t: text.slice(0, MAX_CHARS) }; ok++;
    } catch (e) { failed.push(`${p.n}: ${e.message}`); if (prev[k]) docs[k] = prev[k]; }
  }
  await page.close();
}
await Promise.all(Array.from({ length: PARALLEL }, worker));
await browser.close();

console.log(`Data sheets read: ${ok} of ${P.length}. No TDS listed: ${none.length}. Failed: ${failed.length}.`);
if (none.length) console.log("No TDS found for: " + none.join(" | "));
if (failed.length) console.log("Failed: " + failed.join(" | "));
if (ok < P.length * 0.5) { console.error("Fewer than half of the data sheets could be read. docs.js left unchanged."); process.exit(1); }

const keys = Object.keys(docs).sort();
const js = "/* Text of Dow technical data sheets, for the selector's full-text search. Rebuilt monthly by scripts/build-docs.mjs. */\nwindow.DOW_DOCS={\"updated\":" +
  JSON.stringify(new Date().toISOString().slice(0, 16) + "Z") + ",\n\"docs\":{\n" + keys.map(k => JSON.stringify(k) + ":" + JSON.stringify(docs[k])).join(",\n") + "\n}};\n";
fs.writeFileSync(OUT, js);
console.log(`docs.js written: ${keys.length} products, ${(js.length / 1e6).toFixed(1)} MB.`);
