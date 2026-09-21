import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const root = resolve(import.meta.dirname, "..");
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  try {
    const path = resolve(
      root,
      "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
    );
    if (!path.startsWith(root + sep) && path !== root)
      throw new Error("Outside root");
    const filename = path === root ? resolve(root, "index.html") : path;
    res.setHeader(
      "Content-Type",
      (types[extname(filename)] || "text/plain") + "; charset=utf-8",
    );
    res.end(await readFile(filename));
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;
await mkdir(resolve(root, "test-results"), { recursive: true });
let browser;
try {
  const executablePath =
    process.env.CHROME_BIN ||
    (existsSync("/usr/bin/google-chrome")
      ? "/usr/bin/google-chrome"
      : undefined);
  browser = await chromium.launch({ headless: true, executablePath });
  for (const width of [320, 390, 768, 1440]) {
    const mobile = width < 768;
    const context = await browser.newContext({
      viewport: { width, height: mobile ? 844 : 1000 },
      isMobile: mobile,
      hasTouch: mobile,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage(),
      errors = [],
      remoteRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (!request.url().startsWith("http://127.0.0.1:"))
        remoteRequests.push(request.url());
    });
    await page.goto(url);
    await page.waitForSelector("#toolbar:not([hidden])");
    async function checkSummary() {
      assert.equal(
        await page
          .locator('#stats [data-metric="branches"] strong')
          .innerText(),
        "7",
      );
      assert.equal(
        await page.locator('#stats [data-metric="people"] strong').innerText(),
        "322",
      );
      assert.equal(
        await page
          .locator('#stats [data-metric="generations"] strong')
          .innerText(),
        "6",
      );
      assert.match(
        await page
          .locator('#stats [data-metric="generations"]')
          .getAttribute("aria-label"),
        /generation 1/,
      );
      assert.doesNotMatch(
        await page.locator("#stats").innerText(),
        /CSV name entries|family entries/i,
      );
    }
    await checkSummary();
    assert.equal(await page.locator("#tree-content .family-card").count(), 8);
    assert.equal(
      await page.locator("#map-view").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await page.locator("#branch").inputValue(), "all");
    assert.equal(
      await page
        .locator('#tree-content .toggle-branch[aria-expanded="false"]')
        .count(),
      7,
    );
    await page.locator("#expand-all").click();
    assert.equal(await page.locator("#tree-content .family-card").count(), 209);
    await checkSummary();
    await page.reload();
    await page.waitForSelector("#toolbar:not([hidden])");
    assert.equal(await page.locator("#tree-content .family-card").count(), 8);
    await page.locator("#collapse-all").click();
    assert.equal(await page.locator("#tree-content .family-card").count(), 8);
    await checkSummary();
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /uncertain|unverified|to confirm|open questions|source question|placement pending/i,
    );
    await page.screenshot({
      path: resolve(root, `test-results/default-all-branches-${width}.png`),
    });
    async function noOverflow() {
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `Horizontal overflow at ${width}px`,
      );
    }
    await noOverflow();
    async function checkGrid() {
      const values = await page
        .locator("#tree-content")
        .evaluate((container) => {
          const matrix = new DOMMatrix(
            getComputedStyle(container.querySelector(".map-stage")).transform,
          );
          const style = getComputedStyle(container);
          return {
            x: parseFloat(style.backgroundPositionX),
            y: parseFloat(style.backgroundPositionY),
            size: style.backgroundSize
              .split(" ")
              .map((value) => parseFloat(value)),
            dot: parseFloat(style.getPropertyValue("--grid-dot")),
            chartX: matrix.e,
            chartY: matrix.f,
            zoom: matrix.a,
          };
        });
      for (const [actual, expected] of [
        [values.x, values.chartX],
        [values.y, values.chartY],
        [values.size[0], 20 * values.zoom],
        [values.size[1], 20 * values.zoom],
        [values.dot, values.zoom],
      ]) {
        assert(
          Math.abs(actual - expected) < 0.005,
          `Grid tracks diagram: ${JSON.stringify(values)}`,
        );
      }
    }
    await checkGrid();
    async function checkConnectors() {
      const result = await page.locator(".map-stage").evaluate((stage) => {
        const errors = [];
        let single = 0,
          multiple = 0;
        for (const list of stage.querySelectorAll(".map-tree li > ul")) {
          if (!list.offsetHeight) continue;
          const items = [...list.children];
          if (getComputedStyle(list).borderLeftWidth !== "0px")
            errors.push("Full-height border on child list");
          if (items.length === 1) {
            single++;
            if (getComputedStyle(items[0], "::after").display !== "none")
              errors.push("Vertical line on an only child");
          } else if (items.length > 1) {
            multiple++;
            const first = items[0],
              last = items.at(-1);
            const start = parseFloat(getComputedStyle(first, "::after").top);
            const firstHorizontal = parseFloat(
              getComputedStyle(first, "::before").top,
            );
            const end =
              parseFloat(getComputedStyle(last).height) -
              parseFloat(getComputedStyle(last, "::after").bottom);
            const lastHorizontal = parseFloat(
              getComputedStyle(last, "::before").top,
            );
            if (Math.abs(start - firstHorizontal) > 0.1)
              errors.push("Line above first connection");
            if (Math.abs(end - lastHorizontal) > 0.1)
              errors.push("Line below last connection");
            for (let i = 1; i < items.length; i++) {
              const a = items[i - 1],
                b = items[i];
              const ar = a.getBoundingClientRect(),
                br = b.getBoundingClientRect();
              const scale = ar.height / parseFloat(getComputedStyle(a).height);
              const aEnd =
                ar.bottom -
                parseFloat(getComputedStyle(a, "::after").bottom) * scale;
              const bStart =
                br.top + parseFloat(getComputedStyle(b, "::after").top) * scale;
              if (Math.abs(aEnd - bStart) > 0.1)
                errors.push("Gap between vertical segments");
            }
          }
        }
        return { errors, single, multiple };
      });
      assert.deepEqual(result.errors, [], `Connector geometry at ${width}px`);
      assert(
        result.single > 0 && result.multiple > 0,
        "Exercise both only-child and sibling connectors",
      );
    }
    // Connector coverage needs deeper generations than the collapsed default.
    await page.locator("#expand-all").click();
    await checkConnectors();
    await page.locator("#collapse-all").click();
    assert.equal(await page.locator("#tree-content .family-card").count(), 8);
    async function accessible() {
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        audit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        [],
      );
    }
    await accessible();
    // Nicknames and gender badges replace display honorifics.
    await page.locator("#search").fill("Keya");
    assert.equal(await page.locator(".results .family-card").count(), 1);
    assert.equal(
      await page.locator(".results .subtree-count").innerText(),
      "1 child · 2 total descendants",
    );
    await checkSummary();
    assert.match(
      await page.locator(".results").innerText(),
      /Sumita Chatterjee/,
    );
    const sizes = await page
      .locator(".results .member:has(.nickname)")
      .first()
      .evaluate((n) => ({
        primary: parseFloat(
          getComputedStyle(n.querySelector(".member-name")).fontSize,
        ),
        nickname: parseFloat(
          getComputedStyle(n.querySelector(".nickname")).fontSize,
        ),
        primaryY: n.querySelector(".member-name").getBoundingClientRect()
          .bottom,
        nicknameY: n.querySelector(".nickname").getBoundingClientRect().top,
      }));
    assert(sizes.nickname < sizes.primary && sizes.nicknameY >= sizes.primaryY);
    assert.equal(
      await page
        .locator(".results")
        .getByRole("img", { name: "Male", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator(".results")
        .getByRole("img", { name: "Female", exact: true })
        .count(),
      1,
    );
    assert.doesNotMatch(
      await page.locator(".results .members").innerText(),
      /\bSmt\.?|\bMiss\b/,
    );
    if (mobile) await page.locator(".results .card-main").tap();
    else await page.locator(".results .card-main").click();
    assert(await page.locator("#person-dialog").evaluate((d) => d.open));
    assert.equal(
      await page
        .locator("#detail-content")
        .getByRole("heading", { name: "Children", exact: true })
        .count(),
      1,
    );
    assert.doesNotMatch(
      await page.locator("#detail-content").innerText(),
      /Connected entries/,
    );
    assert.deepEqual(
      await page.locator("#detail-content .gender-label").allTextContents(),
      ["Male", "Female"],
    );
    await page.screenshot({
      path: resolve(root, `test-results/gender-details-${width}.png`),
    });
    await accessible();
    assert.match(
      await page.locator("#detail-content").innerText(),
      /“Keya” · nickname/,
    );
    assert.doesNotMatch(
      await page.locator("#detail-content").innerText(),
      /SMT\. KEYA CHATTERJEE|Sources & original spellings|CSV row|Existing tree/,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#person-dialog").evaluate((d) => d.open),
      false,
    );
    await page.locator("#search").fill("Pankoj");
    assert.equal(await page.locator(".results .gender-badge").count(), 1);
    assert.equal(
      await page.locator(".results .gender-badge").getAttribute("aria-label"),
      "Male",
    );
    await page.locator("#search").fill("Upasana");
    await page.locator(".results .card-main").click();
    assert.match(
      await page.locator("#detail-content").innerText(),
      /No children\./,
    );
    await page.locator("#close-dialog").click();
    // New family entries are searchable with correct ancestry.
    await page.locator("#search").fill("Orkojeet Banerjee");
    assert.equal(await page.locator(".results .family-card").count(), 1);
    assert.match(
      await page.locator(".result-path").innerText(),
      /Amajit Banerjee \/ Srabani Roychoudhury/,
    );
    await page.locator(".results .card-main").click();
    assert.match(
      await page.locator("#detail-content").innerText(),
      /Orkojeet Banerjee/,
    );
    assert.doesNotMatch(
      await page.locator("#detail-content").innerText(),
      /Sources & original spellings|Added from family confirmation/,
    );
    await page.locator("#close-dialog").click();
    await page.locator("#search").fill("Arjit Banerjee");
    assert.equal(await page.locator(".results .family-card").count(), 1);
    assert.match(await page.locator(".results").innerText(), /Anusha Rajah/);
    assert.match(
      await page.locator(".result-path").innerText(),
      /Avijit Banerjee \/ Malabika Banerjee/,
    );
    await page.locator(".results .card-main").click();
    assert.match(
      await page.locator("#detail-content .detail-links").innerText(),
      /Jai Banerjee/,
    );
    assert.match(
      await page.locator("#detail-content .detail-links").innerText(),
      /Maya Banerjee/,
    );
    await page.locator("#close-dialog").click();
    // Find a preserved later-generation descendant absent from CSV.
    await page.locator("#search").fill("Anika");
    assert.match(await page.locator(".results").innerText(), /Anika Chowdhury/);
    await page
      .getByRole("button", { name: "Show in tree →", exact: true })
      .click();
    assert.equal(await page.locator("#branch").inputValue(), "F");
    assert(await page.locator('[data-node-id="F2_1b2"]').isVisible());
    // Expansion, branch isolation, names with alternate spellings, and no result state.
    await page.locator("#branch").selectOption("all");
    await page.locator("#expand-all").click();
    assert.equal(await page.locator("#tree-content .family-card").count(), 209);
    await noOverflow();
    await page.locator("#search").fill("Pinku");
    assert.equal(await page.locator(".results .family-card").count(), 1);
    await page.locator(".results .card-main").click();
    assert.match(
      await page.locator("#detail-content").innerText(),
      /“Pinku” · nickname/,
    );
    await page.locator("#close-dialog").click();
    await page.locator("#search").fill("doesnotexistxyz");
    assert.match(
      await page.locator("#tree-content").innerText(),
      /No matching names/,
    );
    await page.locator("#search").fill("<img src=x onerror=alert(1)>");
    assert.equal(await page.locator("#tree-content img").count(), 0);
    await page.locator("#clear-search").click();
    assert.equal(
      await page.locator('#branch option[value="unplaced"]').count(),
      0,
    );
    await page.locator("#branch").selectOption("C");
    await checkSummary();
    assert.equal(
      await page.locator("#children-CSV_C_6 > li > .family-card").count(),
      4,
    );
    assert.match(
      await page
        .locator('#children-CSV_C_6 [data-node-id="UNPLACED_146"]')
        .innerText(),
      /Doli Banerjee/,
    );
    assert.match(
      await page
        .locator('#children-CSV_C_6 [data-node-id="UNPLACED_146"]')
        .innerText(),
      /Mrinal Banerjee/,
    );
    await page.locator("#search").fill("Bapi");
    assert.equal(await page.locator(".results .family-card").count(), 1);
    assert.match(
      await page.locator(".result-path").innerText(),
      /Bina Mukherjee \/ Barun Mukherjee/,
    );
    await page.locator("#clear-search").click();
    await page.locator("#list-view").click();
    await page.locator("#branch").selectOption("F");
    await page.locator("#collapse-all").click();
    await page.locator("#tree-content .toggle-branch").click();
    await page.locator('[data-node-id="F5"] .toggle-branch').click();
    await page.locator('[data-node-id="F5_1"] .toggle-branch').click();
    await page.locator('[data-node-id="F5_2"] .toggle-branch').click();
    await page.screenshot({
      path: resolve(root, `test-results/list-${width}.png`),
      fullPage: true,
    });
    // Diagram fit, zoom buttons, reset, keyboard and actual pointer gestures.
    await page.locator("#map-view").click();
    await page.waitForTimeout(100);
    await noOverflow();
    const initialZoom = await page.locator("#zoom-level").innerText();
    await page.locator("#zoom-in").click();
    assert.notEqual(await page.locator("#zoom-level").innerText(), initialZoom);
    await checkGrid();
    await page.locator("#reset-map").click();
    assert.equal(await page.locator("#zoom-level").innerText(), "100%");
    await checkGrid();
    await checkConnectors();
    await page.locator("#search").fill("Ria Chatterjee");
    await page
      .getByRole("button", { name: "Show in tree →", exact: true })
      .click();
    await page.waitForTimeout(50);
    await page.locator("#tree-content").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(root, `test-results/connector-fix-${width}.png`),
    });
    await page.locator("#tree-content").focus();
    const before = await page.locator(".map-stage").getAttribute("style");
    await page.keyboard.press("ArrowRight");
    assert.notEqual(
      await page.locator(".map-stage").getAttribute("style"),
      before,
    );
    await checkGrid();
    await page.locator("#tree-content").scrollIntoViewIfNeeded();
    const box = await page.locator("#tree-content").boundingBox();
    const dragBefore = await page.locator(".map-stage").getAttribute("style");
    await page.mouse.move(box.x + 12, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 40, { steps: 6 });
    await page.mouse.up();
    assert.notEqual(
      await page.locator(".map-stage").getAttribute("style"),
      dragBefore,
    );
    await checkGrid();
    if (mobile) {
      // Touch synthesis in this isolated test browser, not a user's profile.
      const cdp = await context.newCDPSession(page);
      const x = box.x + box.width / 2,
        y = box.y + Math.min(140, box.height / 2);
      const zoomBefore = await page.locator("#zoom-level").innerText();
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: x - 35, y, id: 1 },
          { x: x + 35, y, id: 2 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: x - 70, y, id: 1 },
          { x: x + 70, y, id: 2 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      assert.notEqual(
        await page.locator("#zoom-level").innerText(),
        zoomBefore,
      );
      assert.equal(
        await page.locator("#person-dialog").evaluate((d) => d.open),
        false,
      );
      await cdp.detach();
      await checkGrid();
    }
    await page.locator("#fit-map").click();
    await checkGrid();
    await page.locator("#branch").selectOption("all");
    await page.locator("#expand-all").click();
    const fitted = await page.locator(".map-stage").evaluate((stage) => {
      const a = stage.getBoundingClientRect(),
        b = stage.parentElement.getBoundingClientRect();
      return (
        a.left >= b.left - 1 &&
        a.top >= b.top - 1 &&
        a.right <= b.right + 1 &&
        a.bottom <= b.bottom + 1
      );
    });
    assert(fitted, "Fit includes the fully expanded tree");
    await page.locator("#branch").selectOption("F");
    await page.locator("#collapse-all").click();
    await page.locator("#tree-content .toggle-branch").click();
    await page.locator("#fit-map").click();
    await page.locator('[data-node-id="F5"] .toggle-branch').click();
    await page.locator("#fit-map").click();
    await page.screenshot({
      path: resolve(root, `test-results/diagram-${width}.png`),
    });
    await page.locator("#list-view").click();
    // Merged entries preserve old links, without duplicating spouses.
    await page.goto(url + "#entry=G1_1b");
    await page.waitForSelector("#person-dialog[open]");
    assert.match(
      await page.locator("#detail-content").innerText(),
      /Amal Banerjee/,
    );
    assert.match(
      await page.locator("#detail-content").innerText(),
      /Kalpna Banerjee/,
    );
    await page.locator("#close-dialog").click();
    // Deferred relationships use neutral grouping, never questions or guessed marriages.
    await page.goto(url + "#entry=F1_1a");
    await page.waitForSelector("#person-dialog[open]");
    assert.equal(
      await page.locator("#detail-content .detail-label").innerText(),
      "Family entry",
    );
    assert.match(
      await page.locator("#detail-content").innerText(),
      /Tilak Mukherjee/,
    );
    assert.doesNotMatch(
      await page.locator("#detail-content").innerText(),
      /uncertain|unverified|to confirm|question|siblings|married/i,
    );
    await page.screenshot({
      path: resolve(root, `test-results/details-${width}.png`),
    });
    // Focus cannot escape the modal via Tab.
    for (let i = 0; i < 15; i++) await page.keyboard.press("Tab");
    assert(
      await page.evaluate(() =>
        document.querySelector("dialog").contains(document.activeElement),
      ),
    );
    await page.keyboard.press("Escape");
    if (mobile) {
      await page.locator("#map-view").click();
      await page.locator("#search").fill("Keya");
      await page
        .getByRole("button", { name: "Show in tree →", exact: true })
        .tap();
      await page.waitForTimeout(450);
      await page.locator('[data-node-id="F4_1"] .card-main').tap();
      assert(
        await page.locator("#person-dialog").evaluate((d) => d.open),
        "Diagram cards respond to touch taps",
      );
      await page.locator("#close-dialog").tap();
      await page.setViewportSize({ width: 844, height: width });
      await noOverflow();
      await page.locator("#list-view").click();
      await page.setViewportSize({ width, height: 844 });
    }
    await noOverflow();
    assert.deepEqual(errors, []);
    assert.deepEqual(remoteRequests, []);
    await context.close();
    console.log(
      `PASS ${width}px: search, nickname, preservation, expand/collapse, filtering, overflow, diagram, gestures, deep links, modal keyboard, no external requests`,
    );
  }
  // Every entry opens without source fields, including unsure entries with no gender.
  const detailsPage = await browser.newPage();
  await detailsPage.goto(`${url}index.html`);
  await detailsPage.waitForSelector("#toolbar:not([hidden])");
  const entriesChecked = await detailsPage.evaluate(async () => {
    const data = await (await fetch("family-data.json")).json();
    for (const node of data.nodes) {
      openDetails(node.id);
      const dialog = document.getElementById("person-dialog");
      const content = document.getElementById("detail-content");
      if (!dialog.open || content.querySelectorAll(".member").length !== node.members.length)
        throw new Error(`Missing family details for ${node.id}`);
      if (/Sources & original spellings|CSV row|name column|Existing tree|CSV register|Family confirmation/i.test(content.textContent))
        throw new Error(`Source information remains for ${node.id}`);
      dialog.close();
    }
    return data.nodes.length;
  });
  assert.equal(entriesChecked, 209);
  await detailsPage.close();
  console.log("PASS all 209 entries show family details without source information");
  // Counters derive from the actual people and graph, not cached totals
  // or visible cards. A new generation adds one person, not their two aliases.
  const fixture = JSON.parse(
    await readFile(resolve(root, "family-data.json"), "utf8"),
  );
  fixture.nodes
    .find((node) => node.id === "F1_1b1")
    .children.push("TEST_GENERATION_7");
  fixture.nodes.push({
    id: "TEST_GENERATION_7",
    code: "",
    branch: "F",
    relationship: "individual",
    children: [],
    members: [
      {
        name: "Test Person",
        nicknames: ["Test nickname"],
        alternateNames: ["Test alias"],
      },
    ],
    notes: [],
  });
  const summaryPage = await browser.newPage();
  await summaryPage.route("**/family-data.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(fixture),
    }),
  );
  await summaryPage.goto(url);
  await summaryPage.waitForSelector("#toolbar:not([hidden])");
  assert.equal(
    await summaryPage
      .locator('#stats [data-metric="people"] strong')
      .innerText(),
    "323",
  );
  assert.equal(
    await summaryPage
      .locator('#stats [data-metric="generations"] strong')
      .innerText(),
    "7",
  );
  assert.equal(
    await summaryPage.locator("#tree-content .family-card").count(),
    8,
  );
  await summaryPage.close();
  console.log(
    "PASS people and maximum-generation counters follow data changes, excluding aliases",
  );
  // Both HTTP and invalid-graph failures should be actionable, not a blank screen.
  for (const mode of ["http", "invalid-data"]) {
    const page = await browser.newPage();
    await page.route("**/family-data.json", (route) =>
      route.fulfill(
        mode === "http"
          ? { status: 503, body: "Unavailable" }
          : {
              contentType: "application/json",
              body: JSON.stringify({ nodes: [] }),
            },
      ),
    );
    await page.goto(url);
    await page.waitForSelector(".error");
    assert.match(
      await page.locator(".error").innerText(),
      /Serve this folder over HTTP/,
    );
    assert(await page.getByRole("button", { name: "Try again" }).isVisible());
    await page.close();
  }
  console.log("PASS fetch and invalid-data recovery states");
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
