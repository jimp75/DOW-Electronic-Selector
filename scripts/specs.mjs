// Pulls the key numbers out of a technical data sheet's text, so product cards can be completed
// when Dow's product page does not state them (e.g. DOWSIL TC-3120: 12 W/m·K is only in the TDS).
// Text may come from pdftotext or pdfjs, so every pattern tolerates different column orders.
export function extractSpecs(raw) {
  const t = raw.replace(/\|/g, " ").replace(/\s+/g, " ");
  const out = {};

  // Thermal conductivity, W/m·K: "Thermal Conductivity 12.0 W/m·K" or "Thermal Conductivity W/m·K 12.0"
  const unit = "W\\s?\\/\\s?m\\s?[·.\\-*\\s]?\\s?K";
  const kRx = [new RegExp("thermal\\s+conductivity[^0-9]{0,50}?(\\d+(?:[.,]\\d+)?)\\s*" + unit, "i"),
               new RegExp("thermal\\s+conductivity[^0-9]{0,30}?" + unit + "[^0-9]{0,15}(\\d+(?:[.,]\\d+)?)", "i")];
  for (const rx of kRx) { const m = rx.exec(t); if (m) { const v = parseFloat(m[1].replace(",", ".")); if (v >= 0.1 && v <= 40) { out.k = v; break; } } }

  // One-part / two-part
  const pm = /\bone or two part\s+(one|two)\b/i.exec(t) || /\b(one|two)[- ]part\b/i.exec(t.slice(0, 2500));
  if (pm) out.parts = pm[1].toLowerCase() === "one" ? "1K" : "2K";

  // Cure system, from the description at the start of the sheet
  const head = t.slice(0, 1800).toLowerCase();
  if (/non-?curing|does not cure/.test(head)) out.cure = "Non-curing";
  else if (/heat[- ]cur|heat[- ]accelerated|thermal cur/.test(head)) out.cure = "Heat";
  else if (/moisture[- ]cur|neutral cure|acetoxy/.test(head)) out.cure = "Moisture";
  else if (/\buv[- ]cur|ultraviolet/.test(head)) out.cure = "UV";
  else if (/room[- ]temperature[- ]cur|rtv|room temp(?:erature)? vulcaniz/.test(head)) out.cure = "Room temp.";

  // Hardness, e.g. "Durometer 70 Shore OO" or "Hardness, Shore A 45"
  const hm = /(?:durometer|hardness)[^0-9A-Za-z]{0,25}(?:shore\s?(oo|a|d)[^0-9]{0,15})?(\d{1,3})(?:[^A-Za-z0-9]{0,15}shore\s?(oo|a|d))?/i.exec(t);
  if (hm && (hm[1] || hm[3])) out.hard = `Shore ${(hm[1] || hm[3]).toUpperCase()} ${hm[2]}`;
  return out;
}
