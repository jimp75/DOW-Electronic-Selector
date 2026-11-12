# Dow electronics materials selector

A public, self-updating product selector for Dow's electronics materials (DOWSIL™, SYLGARD™, SILASTIC™ and related products), published by DGE Specialty Chemicals.

**Live site:** GitHub Pages for this repository.

## How it stays current
- `products.js` holds the product data (name, function, type, thermal conductivity, cure, components, Dow submarkets, particularities, links to the product page and TDS).
- `.github/workflows/refresh.yml` runs on the 1st of every month (and on demand from **Actions → Refresh product data → Run workflow**).
- It opens Dow's public electronics product listings in a headless browser (`scripts/refresh.mjs`), adds new products, removes discontinued ones, updates submarket tags, and commits `products.js`. GitHub Pages then serves the new data.
- No API keys or paid services are used. If Dow's listing can't be read completely, the job fails and changes nothing; GitHub emails the repository owner.

## Search inside the data sheets
- `scripts/build-docs.mjs` (run after `refresh.mjs` by the same workflow) downloads each product's English technical data sheet, extracts the text with `pdftotext` and writes `docs.js`.
- The page loads `docs.js` after it opens. The search box then also looks inside the data sheets (hardness, Shore, durometer, viscosity, standards…) and shows the matching passage under each product. The "Search inside data sheets" box turns it off.
- If most data sheets cannot be read, `docs.js` is left as it was.

## Products Dow does not list under Electronics
- Besides Dow's Electronics market listing, `refresh.mjs` reads the "Conductive Materials" product-technology listing (finds e.g. TC-8540, EC-6484).
- `extras.json` lists products Dow publishes but shows in no listing the script can read (e.g. TC-5622). Add an entry (name, product page link, short description) and they are kept at every refresh.

## Scope
Included: thermal management, protection, bonding & sealing, electrical conduction, surface preparation & cleaning, heat transfer & fluids. Process chemicals and polymers/rubbers/additives are excluded on purpose.

Unofficial tool. Values are typical and for preliminary screening only; always confirm with the current Dow technical data sheet. DOWSIL™, SYLGARD™ and SILASTIC™ are trademarks of The Dow Chemical Company.
