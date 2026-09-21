# Mukherjee & Banerjee family tree

An expandable family register covering branches A–G, with 322 people in 209 family entries. `family-data.json` is the sole maintained family dataset.

## Open locally

No build or npm installation is needed to use the site. With Python 3 installed:

```sh
python3 scripts/serve_lan.py
```

Open <http://localhost:8000/>. `index.html` is the family-tree page. Older `family-tree.html` links redirect to it while preserving query strings and entry hashes. Opening the page directly as a `file:` URL will not load the JSON in most browsers. `npm run serve` starts the same preview server.

For hosting, publish `index.html`, the `family-tree.html` redirect, `family-tree.css`, `family-tree.js` and `family-data.json`. The reusable preview server enforces this allowlist and defaults to loopback-only access. There are no CDN scripts, analytics or external fonts. `_config.yml` excludes development files and local notes from GitHub Pages.

The JSON contains family names and relationships. Anyone with access to a hosted copy can download it. Choose the hosting audience before publishing.

## Exploring the tree

- The summary shows **Family branches**, **Total people** and **Max. generations** across the full dataset. Nicknames and alternate names are not extra people. The common ancestors are generation 1; spouses in the same entry share a generation. Filtering and collapsing do not change these totals.
- Search names, nicknames, alternate names or register codes. Search is scoped to the selected branch; choose “All branches” to search everything.
- Use **+ / −** on a card to expand or collapse that branch. The controls announce their state to screen readers.
- Tap a name card to see family details, the path to the roots and children. Dialogs support keyboard navigation and Escape.
- The **Diagram** is the default on phones and desktops, starting with the common roots and all seven branch heads visible. Open individual branches, use **Expand all**, select a branch, or search for a person. **List** remains available for easy reading.
- The diagram supports background dragging, touch panning, two-finger pinch zoom, zoom buttons, Fit and Reset. Control + mouse wheel zooms around the pointer. Focus the diagram background and use arrow keys to pan, `+` / `-` to zoom, or `0` to fit. Regular wheel scrolling still scrolls the page. The dotted background moves and scales with the chart.
- Search results offer **Show in tree**. Detail panels can copy a link such as `index.html#entry=F4_1`.
- Unattached entries appear under **Other family entries** and remain searchable. They are not attached to guessed parents.

Nicknames appear in smaller italic text below the name. Alternate names remain distinct from nicknames. Cards use small monochrome ♂/♀ badges with accessible labels; detail panels show Male/Female. The current data includes family-recorded markers and reviewed best-guess markers based on names and family context. The 16 ambiguous names remain unmarked and have no badge.

## Maintaining the data

Edit `family-data.json` directly, then run the tests below. There is no import or regeneration step. The original CSV, tree snapshot, source-specific merge scripts and merge report have been removed. Source labels, original-spelling records, row/column references and gender-source metadata are not stored or displayed.

The schema-v3 JSON contains:

- `rootId`, `unplacedIds` and `nodes` for the family graph.
- Stable node IDs and `idRedirects` for merged entries. Keep existing IDs, including those beginning with `CSV_` or `UNPLACED_`, so links and relationships continue to work. These are identifiers, not embedded source records.
- Each node's members, relationship type (`couple`, `individual` or `group`), child IDs, branch, register code and public notes.
- Member names, nickname and alternate-name arrays, plus optional gender.
- Optional `lineageMemberIndex` and `childrenStatus`. `childrenStatus: "none"` records an explicit statement of no children; an empty child list alone does not make that claim.

Preserve established spellings, surnames and family-line-first member ordering unless a correction is confirmed. Do not merge namesakes automatically or change neutral groups into couples without confirmation. Treat gender markers as reviewable family-tree data: leave ambiguous names unmarked rather than forcing a guess, and replace best-guess markers when the family confirms them. New entries need unique, stable IDs and must be connected to the graph or listed in `unplacedIds`.

Private questions are kept locally in git-ignored `FOLLOW-UP-QUESTIONS.md`, never embedded in the public JSON or linked from the page. The preview server does not serve this file or repository internals.

## Tests

Data and preview-server tests need only Python:

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
# Or: npm run test:data
```

For browser tests, install the development dependencies:

```sh
npm ci
# If Chrome is not installed:
npx playwright install chromium
npm test
```

Browser tests use `/usr/bin/google-chrome` if available, otherwise Playwright Chromium. Set `CHROME_BIN` for another Chrome path. Tests launch a separate headless browser and a temporary loopback-only HTTP server; both close when the suite finishes.

Checks cover graph integrity, family relationships, nicknames, absence of source metadata, search, branch filtering, expand/collapse, every entry's detail dialog, deep links, keyboard controls, diagram gestures and load failures. Browser layouts are tested at 320, 390, 768 and 1440 CSS pixels, including touch taps, pinch simulation and orientation changes on phone sizes. Axe checks run against the main page and detail dialog for WCAG A/AA issues. Screenshots are saved under ignored `test-results/`.

These are automated Chrome checks, not a claim of testing on physical iPhones or every mobile browser.
