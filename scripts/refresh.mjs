// Monthly refresh of products.js from Dow's public electronics product listings.
// Runs in GitHub Actions with a headless Chromium (Playwright). No API keys, no paid services.
// Safety: if Dow's listing can't be read completely, the script exits with an error and changes nothing.
import { chromium } from "playwright";
import fs from "node:fs";
import vm from "node:vm";

const FILE = new URL("../products.js", import.meta.url);
const FN_ORDER = ["thermal", "protection", "assembly", "conductive", "prep", "fluids"];
const KEYS = ["n","fn","type","k","cure","cureAlt","parts","ratio","visc","hard","temp","mkt","app","d","f","u"];
const SUBS=[["Consumer, Computer and Communications","Consumer, computer & comms"],["Transportation and e-mobility","Transportation & e-mobility"],
 ["Industrial Power and Energy","Industrial power & energy"],["Lighting","Lighting"],["Avionics, Aerospace and Defense","Aerospace & defense"],
 ["Avionics, Aerospace and Defense|Rockets, Satellites and Launch Equipment","Space & launch"],["MEMS Sensors and Actuators","MEMS sensors & actuators"],
 ["Printed Circuit Boards","Printed circuit boards"],["Semiconductors","Semiconductors"],["Displays","Displays"],["Data Center Cooling","Data center cooling"]];
const MKT_ORDER=[...SUBS.map(s=>s[1]),"Electronics (general)"];
const listUrl=(path,first)=>`https://www.dow.com/en-us/search.html#tab=Products&sortCriteria=%40title%20ascending&firstResult=${first}&numberOfResults=100&cf-dow_market_hierarchy=${path}`;
const pathOf=sub=>["Electronics",...(sub?sub.split("|"):[])].map(encodeURIComponent).join(",");
const nk=n=>n.replace(/[™®]/g,"").replace(/\\_/g,"_").toLowerCase().replace(/\s+/g,"");

function parseListing(md){
  const h=/Results\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/.exec(md);
  const items=[];const rx=/^\[(?:!\[[^\]]*\]\([^)]*\)\\*\n)?([^\]\n]+)\]\((https:\/\/www\.dow\.com\/en-us\/pdp\.[^)?#\s]+)[^)]*\)\n\n/gm;let m;
  while((m=rx.exec(md))){const n=m[1].replace(/\s+/g," ").trim();if(n==="Documents")continue;
    const rest=md.slice(rx.lastIndex);const e=rest.indexOf("\n\nFavorite");let d=e>=0&&e<1500?rest.slice(0,e):"";if(/^Favorite/.test(d))d="";
    items.push({n:n.replace(/\\_/g,"_"),u:m[2],d:d.replace(/\s+/g," ").trim()});}
  return{total:h?+h[3]:null,items};
}

/* Out of scope by the owner's choice: process chemicals and polymers/rubbers/additives. */
function excluded(n){const s=n.toLowerCase();
  if(/^(paraloid|axeleron|dow™ d[fgk]d|syl-off|carbowax|dowanol|tergitol|dowfax|ecosurf|ucon|ucar™ ester|proglyde|butyl |hexyl |methyl |propyl |propanol|propionic|primary amyl|polyglycol|monoethanolamine|monoisopropanolamine|n-methyl|ethylenediamine|triethanolamine|amine stripper|carbitol|propylene glycol)/.test(s))return true;
  if(/^silastic/.test(s)&&!/additive/.test(s)&&/rubber|moldable|compound|base & curing/.test(s))return true;
  if(/^silastic/.test(s)&&/additive/.test(s))return true;
  if(/^xiameter/.test(s)&&/rubber/.test(s))return true;
  if(/surfactant|\bresin\b|additive|\bcatalyst$/.test(s))return true;
  return false;}

/* Classify a product that is new to the selector, from Dow's own name and description only. */
const COLORS=["transparent green","translucent green","dark gray","dark grey","reddish brown","transparent","translucent","clear","black","white","gray","grey","blue","pink","beige","red"];
const FEATS=[[/ul 94 v-0/,"UL 94 V-0"],[/\bul\b/,"UL recognized"],[/\bipc\b/,"IPC"],[/\bmil\b|mil spec/,"MIL"],[/no solvent added|solventless/,"solvent-free"],
 [/solvent borne/,"solvent-borne"],[/low voc/,"low VOC"],[/abrasion resistant/,"abrasion resistant"],[/stress relieving/,"stress-relieving"],[/primerless/,"primerless"],
 [/self[- ]priming/,"self-priming"],[/uv indicator|uv traceable/,"UV indicator"],[/re-?workable/,"reworkable"],[/controlled volatility|\bcv\b/,"controlled volatility (CV)"],
 [/fast tack-free/,"fast tack-free"],[/rapid dispense/,"fast dispensing"],[/fast cure|fast room temperature|fast moisture/,"fast cure"],[/low density/,"low density"],
 [/high purity/,"high purity"],[/high transparency/,"high transparency"],[/reduced yellowing/,"reduced yellowing"],[/optical/,"optically clear"],[/fluorosilicone/,"fluorosilicone"],
 [/low fogging/,"low fogging"],[/high (tensile )?strength/,"high strength"],[/non-corrosive/,"non-corrosive"],[/neutral cure/,"neutral cure"],[/acetoxy/,"acetoxy cure"],
 [/alkoxy/,"alkoxy cure"],[/long working time/,"long working time"],[/low thermal resistance/,"low thermal resistance"],[/latent cure/,"latent cure"],[/die attach/,"die attach"],
 [/shielding|\bemi\b/,"EMI shielding"],[/flame resist/,"flame resistant"],[/immersion/,"immersion cooling"],[/formed?[- ]in[- ]place|cure-in-place/,"formed-in-place gasket (FIPG)"],
 [/potting/,"potting"],[/heat sink/,"heat sink bonding"],[/bare die/,"bare die"],[/thixotropic/,"thixotropic"]];
function classifyNew(o,mkt){
  const n=o.n,nl=n.toLowerCase(),d=o.d,t=(nl+" "+d.toLowerCase());let fn,ty;
  const km=/(\d+(?:\.\d+)?)\s?w\/m/.exec(t);const k=km?parseFloat(km[1]):null;
  if(/\bprimer\b|prime coat|adhesion promoter/.test(nl)){fn="prep";ty="Primer";}
  else if(/\bos-\s?\d/.test(nl)||/cleaning/.test(d.toLowerCase().slice(0,200))){fn="prep";ty="Cleaning fluid";}
  else if(/ablative|abradable/.test(nl)){fn="protection";ty="Ablative / thermal protection";}
  else if(/^(dowcal|dowfrost|dowtherm|ucartherm)/.test(nl)){fn="fluids";ty="Heat transfer fluid";}
  else if(/icl-|cooling fluid|immersion/.test(t)&&/fluid|coolant/.test(t)){fn="fluids";ty="Dielectric coolant";}
  else if(/\bfluid\b/.test(nl)){fn="fluids";ty="Silicone fluid";}
  else if(/foam/.test(nl)){fn="assembly";ty="Foam / gasket";}
  else if(/electrically conductive|shielding/.test(t)||/dowsil™ ec-/.test(nl)){fn="conductive";ty="Conductive adhesive";}
  else if(/coating/.test(nl)||(/conformal coating/.test(t)&&!/adhesive|sealant/.test(nl))){fn="protection";ty="Conformal coating";}
  else if(/carbice|thermal pad/.test(t)&&/pad/.test(nl)){fn="thermal";ty="Thermal pad";}
  else if(k!==null||/thermal/.test(nl)||/thermally conductive/.test(t)){fn="thermal";
    ty=/compound/.test(nl)?"Thermal grease":/encapsulant/.test(nl)?"Thermal encapsulant":/gap filler|thermal pad/.test(t)?"Gap filler":/adhesive/.test(nl)?"Thermal adhesive":"Thermal gel";}
  else if(/optical bonding/.test(nl)){fn="assembly";ty="Optical bonding";}
  else if(/ gel/.test(nl)||/\bgel\b/.test(d.toLowerCase().slice(0,160))){fn="protection";ty=/optical/.test(t)?"Optical gel":"Dielectric gel";}
  else if(/encapsulant|elastomer/.test(nl)){fn="protection";ty="Encapsulant";}
  else{fn="assembly";ty="Adhesive / sealant";}
  const parts=/two[- ]part|\b2[- ]part|two-component/.test(t)||/ kit|base & catalyst|a&b|parts a/.test(nl)?"2K":/one[- ]part|\b1[- ]part|one[- ]component/.test(t)?"1K":"Not stated";
  const rm=/(\d+)\s?(?::|to)\s?(\d+) mix/.exec(t);const ratio=rm?`${rm[1]}:${rm[2]}`:null;
  let cure="Not stated",cureAlt=null;
  if(/non-curing/.test(t))cure="Non-curing";
  else if(/ultraviolet \(uv\) cure with secondary moisture|uv and dual moisture/.test(t)){cure="UV";cureAlt="Moisture";}
  else if(/ultraviolet cure|uv cure/.test(t))cure="UV";
  else if(/room temperature or heat[- ]accelerated|room temperature cure(?: product)? with accelerated heat/.test(t)){cure="Room temp.";cureAlt="Heat";}
  else if(/moisture (cure|rtv)|neutral cure|acetoxy|alkoxy|moisture cure/.test(t))cure="Moisture";
  else if(/latent cure|heat[- ]accelerated cure|heat cure|heat curable|low temperature cure/.test(t))cure="Heat";
  else if(/room temperature cur|\brtv\b/.test(t))cure="Room temp.";
  let visc=null;const vm=/(very low|low|medium|high) viscosity/.exec(t);
  if(vm)visc=vm[1][0].toUpperCase()+vm[1].slice(1);else if(/non-flow/.test(t))visc="Non-flowing";else if(/thixotropic/.test(t))visc="Thixotropic";else if(/flowable|good flow/.test(t))visc="Flowable";
  const hm=/(ultra soft|very soft|soft|firm|tough|hard)[, ]+(?:\w+ )?(gel|encapsulant|elastomer)/.exec(t);const hard=hm?hm[1][0].toUpperCase()+hm[1].slice(1):null;
  const f=[];const col=COLORS.find(c=>new RegExp("\\b"+c+"\\b").test(t));if(col)f.push(col.replace("grey","gray"));
  FEATS.forEach(([rx,l])=>{if(rx.test(t)&&!f.includes(l))f.push(l);});if(ratio)f.push(ratio+" mix");
  let app=null;for(const rx of[/such as ([^.]+)/i,/intended (?:for )?use in ([^.]+)/i,/used in ([^.]+)/i,/suitable for ([^.]+)/i,/for use with ([^.]+)/i]){const m=rx.exec(d);if(m){app=m[1].trim();break;}}
  if(app){app=app.replace(/^(?:potting |use in )/,"");app=app[0].toUpperCase()+app.slice(1);if(app.length>140)app=app.slice(0,137).replace(/\s\S*$/,"")+"…";}
  else app={prep:ty==="Primer"?"Surface preparation for silicone bonding":"Precision cleaning and surface preparation",fluids:"Liquid cooling and heat transfer"}[fn]||"General electronics assembly";
  const noun=ty.toLowerCase();const pw={"1K":"One-part","2K":"Two-part"}[parts]||"";
  let s=[pw,col&&col.replace("grey","gray"),noun].filter(Boolean).join(" ");s=s[0].toUpperCase()+s.slice(1);
  const bits=[];if(k!==null)bits.push(`${k} W/m·K`);
  const cw={"Room temp.":"room-temperature cure","Moisture":"moisture cure","Heat":"heat cure","UV":"UV cure","Non-curing":"non-curing"}[cure];
  if(cw)bits.push(cw+(cureAlt?(cureAlt==="Heat"?" with heat acceleration":" with moisture back-up cure"):""));
  if(visc)bits.push(visc.toLowerCase()+(/^(Very low|Low|Medium|High)$/.test(visc)?" viscosity":""));if(hard)bits.push(hard.toLowerCase());
  let desc=s+(bits.length?", "+bits.join(", "):"")+".";
  const extra=f.filter(x=>x!==col&&!/potting| mix$/.test(x)).slice(0,3);if(extra.length)desc+=" Key points: "+extra.join(", ")+".";
  const e={n,fn,type:ty,k,cure,parts,mkt,app,d:desc,f,u:o.u};
  if(cureAlt)e.cureAlt=cureAlt;if(ratio)e.ratio=ratio;if(visc)e.visc=visc;if(hard)e.hard=hard;
  return e;}


/* ---- read one listing page in a real browser ---- */
async function readPage(page, url) {
  await page.goto("about:blank");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() =>
    /Results\s+\d+\s*-\s*\d+\s+of\s+\d+/.test(document.body.innerText) &&
    document.querySelectorAll('a[href*="/pdp."]').length > 0, null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  return page.evaluate(() => {
    const clean = h => h.split("#")[0].split("?")[0];
    const m = /Results\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/.exec(document.body.innerText);
    const seen = new Map();
    for (const a of document.querySelectorAll('a[href*="/pdp."]')) {
      const txt = (a.innerText || "").replace(/\s+/g, " ").trim();
      if (!txt || /^documents$/i.test(txt)) continue;
      const href = clean(a.href);
      if (!seen.has(href)) seen.set(href, { a, txt });
    }
    const items = [];
    for (const [href, { a, txt }] of seen) {
      let card = a;
      while (card.parentElement) {
        const p = card.parentElement;
        const hs = new Set([...p.querySelectorAll('a[href*="/pdp."]')].map(x => clean(x.href)));
        if (hs.size > 1) break;
        card = p;
      }
      const d = (card.innerText || "").replace(txt, " ").replace(/\b(Favorite|Documents|Sample & Buy|Compare)\b/g, " ").replace(/\s+/g, " ").trim();
      items.push({ n: txt, u: href, d });
    }
    return { total: m ? +m[3] : null, items };
  });
}
async function readListing(page, sub, urlFn = (s, first) => listUrl(pathOf(s), first), label) {
  const first = await readPage(page, urlFn(sub, 0));
  let items = first.items; const total = first.total;
  for (let off = 100; total && off < total; off += 100) items = items.concat((await readPage(page, urlFn(sub, off))).items);
  console.log(`${label || sub || "Electronics (all)"}: ${new Set(items.map(o => o.u)).size} of ${total}`);
  return { total, items };
}
/* Second route into Dow's catalog: its "product technology" tree. Some electronics products (e.g. DOWSIL TC-8540, EC-6484)
   sit here without being tagged to the Electronics market, so the market listing alone misses them. */
const TECH = ["Conductive Materials"];
const techUrl = (path, first) => `https://www.dow.com/en-us/search.html#tab=Products&sortCriteria=%40title%20ascending&firstResult=${first}&numberOfResults=100&cf-dow_producttechnology_hierarchy=${encodeURIComponent(path)}`;
const TECH_BRANDS = /^(dowsil|sylgard|silastic|xiameter)/i;

/* ---- main ---- */
const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(FILE, "utf8"), ctx);
const DATA = ctx.window.DOW_DATA; const P = DATA.products;
// Use the Google Chrome that GitHub's runners already have; fall back to the Playwright download.
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const page = await browser.newPage({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", viewport: { width: 1400, height: 1000 } });
const full = await readListing(page, "");
const subs = [];
for (const [s, lab] of SUBS) { try { subs.push([lab, await readListing(page, s)]); } catch (e) { console.warn(`Submarket ${lab} could not be read: ${e.message}`); subs.push([lab, null]); } }
const tech = [];
for (const t of TECH) { try { tech.push([t, await readListing(page, t, techUrl, "Product technology: " + t)]); } catch (e) { console.warn(`Technology ${t} could not be read: ${e.message}`); tech.push([t, null]); } }
await browser.close();
const techOk = tech.every(([, r]) => r && r.total && new Set(r.items.map(o => nk(o.n))).size >= r.total * 0.9);
/* extras.json: products Dow publishes but lists in no category we can read (e.g. DOWSIL TC-5622). Never removed automatically. */
let extras = []; try { extras = JSON.parse(fs.readFileSync(new URL("../extras.json", import.meta.url), "utf8")); } catch { console.warn("extras.json not found or unreadable; skipped."); }

const fullCount = new Set(full.items.map(o => nk(o.n))).size;
if (!full.total || fullCount < full.total * 0.9) { console.error(`Listing incomplete (${fullCount} of ${full.total}). Nothing changed.`); process.exit(1); }
const complete = fullCount >= full.total && techOk;
const fresh = new Map();
full.items.forEach(o => { const k = nk(o.n); if (!fresh.has(k)) fresh.set(k, { ...o, subs: new Set() }); });
const unreadSubs = new Set(subs.filter(([, r]) => !r).map(([lab]) => lab));
subs.forEach(([lab, r]) => { if (!r) return; r.items.forEach(o => { const k = nk(o.n); if (!fresh.has(k)) fresh.set(k, { ...o, subs: new Set() });
  const x = fresh.get(k); x.subs.add(lab); if (lab === "Space & launch") x.subs.add("Aerospace & defense"); if (!x.d && o.d) x.d = o.d; }); });

tech.forEach(([, r]) => { if (!r) return; r.items.forEach(o => { const k = nk(o.n); if (!fresh.has(k) && TECH_BRANDS.test(o.n)) fresh.set(k, { ...o, subs: new Set() }); }); });
extras.forEach(o => { const k = nk(o.n); if (!fresh.has(k)) fresh.set(k, { ...o, subs: new Set(), extra: true }); });

const byKey = new Map(P.map(p => [nk(p.n), p]));
const out = [], added = [], removed = [], retagged = [];
const pick = p => { const e = {}; KEYS.forEach(x => { if (p[x] !== undefined && p[x] !== null) e[x] = p[x]; }); return e; };
fresh.forEach((o, k) => {
  if (excluded(o.n)) return;
  let mkt = MKT_ORDER.filter(m => o.subs.has(m));
  const cur = byKey.get(k);
  if (cur) {   // keep tags of submarkets that could not be read this time
    cur.mkt.filter(m => unreadSubs.has(m) && !mkt.includes(m)).forEach(m => mkt.push(m));
    mkt = MKT_ORDER.filter(m => mkt.includes(m));
  }
  if (!mkt.length) mkt = ["Electronics (general)"];
  if (cur) { const e = pick(cur); if (JSON.stringify(cur.mkt) !== JSON.stringify(mkt)) { retagged.push(cur.n); e.mkt = mkt; } if (o.u && o.u !== cur.u) e.u = o.u; out.push(e); byKey.delete(k); }
  else { const e = classifyNew(o, mkt); out.push(e); added.push(e.n); }
});
byKey.forEach(p => { if (complete && /\/pdp\./.test(p.u || "")) removed.push(p.n); else out.push(pick(p)); });
out.sort((a, b) => FN_ORDER.indexOf(a.fn) - FN_ORDER.indexOf(b.fn) || a.type.localeCompare(b.type) || (b.k || 0) - (a.k || 0) || a.n.localeCompare(b.n));
if (out.length < P.length * 0.7) { console.error(`Result looks wrong (${out.length} products vs ${P.length} before). Nothing changed.`); process.exit(1); }

const parts = []; if (added.length) parts.push(`added ${added.length}`); if (removed.length) parts.push(`removed ${removed.length}`); if (retagged.length) parts.push(`${retagged.length} submarket tag changes`);
const changes = parts.join("; ") || "none";
const updated = new Date().toISOString().slice(0, 16) + "Z";
const js = "/* Dow electronics selector data. Updated monthly by the GitHub Actions workflow (scripts/refresh.mjs). */\nwindow.DOW_DATA={\n\"updated\":" + JSON.stringify(updated) + ",\n\"changes\":" + JSON.stringify(changes) + ",\n\"products\":[\n" +
  out.map(e => "{" + KEYS.filter(k => e[k] !== undefined && e[k] !== null).map(k => JSON.stringify(k) + ":" + JSON.stringify(e[k])).join(",") + "}").join(",\n") + "\n]};\n";
fs.writeFileSync(FILE, js);
console.log(`Done: ${out.length} products; ${changes}.`);
if (added.length) console.log("Added: " + added.join(" | "));
if (removed.length) console.log("Removed: " + removed.join(" | "));
