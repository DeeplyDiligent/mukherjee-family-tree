"use strict";
// No external scripts, analytics or network services. The JSON is the only input.
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const state = {
  data: null,
  nodes: new Map(),
  parents: new Map(),
  expanded: new Set(),
  branch: "all",
  query: "",
  view: "map",
  selected: null,
  zoom: 1,
  x: 30,
  y: 30,
};
const normalize = (text) =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const label = (n) => n.members.map((m) => m.name).join(" & ");
const shortLabel = (n) => n.members.map((m) => m.name).join(" / ");
const relation = (n) =>
  ({
    couple: "Couple",
    group: "Family entry",
    individual: "Individual",
  })[n.relationship];
const descendants = new Map();
let dialogOpener = null;

function validate(data) {
  if (
    data.schemaVersion !== 3 ||
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.unplacedIds)
  )
    throw new Error("Unsupported family data format.");
  const nodes = new Map(data.nodes.map((n) => [n.id, n]));
  if (nodes.size !== data.nodes.length || !nodes.has(data.rootId))
    throw new Error("Duplicate entries or missing root.");
  const parents = new Map();
  for (const n of data.nodes) {
    if (
      !Array.isArray(n.members) ||
      !n.members.length ||
      !Array.isArray(n.children)
    )
      throw new Error("Incomplete family entry.");
    for (const child of n.children) {
      if (!nodes.has(child) || parents.has(child))
        throw new Error("Invalid family connection.");
      parents.set(child, n.id);
    }
  }
  const seen = new Set(),
    visiting = new Set();
  function walk(id) {
    if (!nodes.has(id) || visiting.has(id))
      throw new Error("Missing entry or circular family connection.");
    if (seen.has(id)) return;
    visiting.add(id);
    nodes.get(id).children.forEach(walk);
    visiting.delete(id);
    seen.add(id);
  }
  [data.rootId, ...data.unplacedIds].forEach(walk);
  if (seen.size !== nodes.size) throw new Error("Unreachable family entries.");
  return { nodes, parents };
}
function ancestors(id) {
  const result = [];
  while (state.parents.has(id)) {
    id = state.parents.get(id);
    result.unshift(id);
  }
  return result;
}
function countDescendants(id) {
  if (!descendants.has(id))
    descendants.set(
      id,
      state.nodes
        .get(id)
        .children.reduce((sum, child) => sum + 1 + countDescendants(child), 0),
    );
  return descendants.get(id);
}
function memberView(m, showGenderLabel = false) {
  const out = el("span", "member");
  const name = el("span", "member-name", m.name);
  const gender = {
    male: { symbol: "♂", label: "Male" },
    female: { symbol: "♀", label: "Female" },
  }[m.gender];
  if (gender) {
    const badge = el("span", "gender-badge", gender.symbol);
    badge.title = gender.label;
    if (showGenderLabel) badge.setAttribute("aria-hidden", "true");
    else {
      badge.setAttribute("role", "img");
      badge.setAttribute("aria-label", gender.label);
    }
    name.append(badge);
  }
  out.append(name);
  m.nicknames.forEach((name) =>
    out.append(el("span", "nickname", `“${name}” · nickname`)),
  );
  m.alternateNames.forEach((name) =>
    out.append(el("span", "alternate-name", `Also recorded as ${name}`)),
  );
  if (gender && showGenderLabel)
    out.append(el("span", "gender-label", gender.label));
  return out;
}
function action(text, fn, cls) {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
}
function card(id, expandable = true) {
  const n = state.nodes.get(id);
  const out = el(
    "div",
    `family-card${state.selected === id ? " selected" : ""}`,
  );
  out.dataset.nodeId = id;
  const main = action("", () => openDetails(id), "card-main");
  const accessibleNames = n.members
    .map((m) =>
      [
        m.name,
        ...(["male", "female"].includes(m.gender) ? [m.gender] : []),
        ...m.nicknames.map((name) => `nickname ${name}`),
        ...m.alternateNames.map((name) => `also recorded as ${name}`),
      ].join(", "),
    )
    .join(" & ");
  main.setAttribute(
    "aria-label",
    `Details: ${accessibleNames}. ${n.code ? n.code + ". " : ""}${relation(n)}`,
  );
  const meta = el("span", "card-meta");
  meta.append(
    el(
      "span",
      "code-tag",
      n.code || (id === state.data.rootId ? "COMMON ROOTS" : "FAMILY"),
    ),
    el("span", "", relation(n)),
  );
  main.append(meta);
  const members = el("span", "members");
  n.members.forEach((m) => members.append(memberView(m)));
  main.append(members);
  if (n.children.length)
    main.append(
      el(
        "span",
        "subtree-count",
        `${n.children.length} ${n.children.length === 1 ? "child" : "children"} · ${countDescendants(id)} total ${countDescendants(id) === 1 ? "descendant" : "descendants"}`,
      ),
    );
  out.append(main);
  if (expandable && n.children.length) {
    const expanded = state.expanded.has(id);
    const toggle = action(
      expanded ? "−" : "+",
      () => {
        const anchor =
          state.view === "map" ? out.getBoundingClientRect() : null;
        if (expanded) state.expanded.delete(id);
        else state.expanded.add(id);
        render();
        const updated = findCard(id);
        if (anchor && updated) {
          const rect = updated.getBoundingClientRect();
          state.x += anchor.left - rect.left;
          state.y += anchor.top - rect.top;
          applyTransform();
        }
        updated
          ?.querySelector(".toggle-branch")
          ?.focus({ preventScroll: true });
      },
      "toggle-branch",
    );
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute(
      "aria-label",
      `${expanded ? "Collapse" : "Expand"} descendants of ${label(n)}`,
    );
    toggle.setAttribute("aria-controls", `children-${id}`);
    out.append(toggle);
  } else if (expandable) out.append(el("span", "leaf-mark"));
  return out;
}
function findCard(id) {
  return [...$("tree-content").querySelectorAll("[data-node-id]")].find(
    (n) => n.dataset.nodeId === id,
  );
}
function tree(ids, top = true) {
  const list = el(
    "ul",
    top ? (state.view === "map" ? "map-tree" : "list-tree") : "",
  );
  ids.forEach((id) => {
    const n = state.nodes.get(id),
      li = el("li");
    li.append(card(id));
    if (n.children.length) {
      const children = state.expanded.has(id)
        ? tree(n.children, false)
        : el("ul");
      children.id = `children-${id}`;
      children.hidden = !state.expanded.has(id);
      li.append(children);
    }
    list.append(li);
  });
  return list;
}
function visibleRoots() {
  if (state.branch === "unplaced") return [];
  if (state.branch === "all") return [state.data.rootId];
  return state.nodes
    .get(state.data.rootId)
    .children.filter((id) => state.nodes.get(id).branch === state.branch);
}
function unplacedIds() {
  return state.data.unplacedIds.filter(
    (id) =>
      ["all", "unplaced"].includes(state.branch) ||
      state.nodes.get(id).branch === state.branch,
  );
}
function matches() {
  const words = normalize(state.query).split(" ").filter(Boolean);
  return state.data.nodes.filter((n) => {
    if (state.branch === "unplaced" && !state.data.unplacedIds.includes(n.id))
      return false;
    if (
      !["all", "unplaced"].includes(state.branch) &&
      n.branch !== state.branch
    )
      return false;
    return words.every((word) => n.searchText.includes(word));
  });
}
function render() {
  const container = $("tree-content");
  const searching = state.query.trim().length > 0,
    diagram = state.view === "map" && !searching;
  container.replaceChildren();
  container.className = "tree-content" + (diagram ? " diagram" : "");
  container.tabIndex = diagram ? 0 : -1;
  container.setAttribute(
    "aria-label",
    diagram
      ? "Family diagram. Drag to pan, pinch or Control plus wheel to zoom. Arrow keys pan; plus and minus zoom; zero fits."
      : "Family entries",
  );
  $("map-controls").hidden = !diagram;
  $("tree-actions").hidden = searching;
  $("list-view").setAttribute("aria-pressed", String(state.view === "list"));
  $("map-view").setAttribute("aria-pressed", String(state.view === "map"));
  $("clear-search").hidden = !state.query;
  $("view-summary").textContent =
    state.branch === "all"
      ? "All seven branches"
      : state.branch === "unplaced"
        ? "Other family entries"
        : `Branch ${state.branch}`;
  $("view-hint").textContent = diagram
    ? "Use + on a card to open its branch. Tap a name for details."
    : "Open a branch with +. Tap a name card for family details.";
  if (searching) {
    const found = matches();
    $("status").textContent =
      `${found.length} matching ${found.length === 1 ? "entry" : "entries"}${state.branch !== "all" ? " in this selection" : " across the register"}. Includes nicknames and alternate names.`;
    if (!found.length) {
      const empty = el("div", "empty");
      empty.append(
        el("h3", "", "No matching names"),
        el(
          "p",
          "",
          "Try a shorter name, another spelling, or search all branches.",
        ),
      );
      empty.append(
        action("Search all branches", () => {
          state.branch = "all";
          $("branch").value = "all";
          render();
        }),
      );
      container.append(empty);
    } else {
      const results = el("div", "results");
      found.forEach((n) => {
        const item = el("div", "result");
        item.append(
          el(
            "p",
            "result-path",
            ancestors(n.id)
              .map((id) => shortLabel(state.nodes.get(id)))
              .join(" › ") ||
              (n.id === state.data.rootId ? "Common roots" : "Family register"),
          ),
        );
        item.append(card(n.id, false));
        const actions = el("div", "result-actions");
        actions.append(action("Show in tree →", () => goTo(n.id)));
        item.append(actions);
        results.append(item);
      });
      container.append(results);
    }
  } else {
    const target = diagram ? el("div", "map-stage") : container;
    const roots = visibleRoots();
    if (roots.length) target.append(tree(roots));
    const pending = unplacedIds();
    if (pending.length) {
      target.append(
        el(
          "h3",
          "unplaced-heading",
          `Other family entries · ${pending.length}`,
        ),
        el("p", "unplaced-note", "More names from the family register."),
      );
      if (diagram) {
        const list = el("div", "unplaced-list");
        pending.forEach((id) => list.append(card(id)));
        target.append(list);
      } else target.append(tree(pending));
    }
    if (diagram) {
      container.append(target);
      applyTransform();
    }
    const shown = container.querySelectorAll(".family-card").length;
    $("status").textContent =
      `${shown} family ${shown === 1 ? "entry" : "entries"} visible. ${diagram ? "Diagram view; switch to List for easy reading." : "Expand a branch to see more generations."}`;
  }
}
function goTo(id) {
  const n = state.nodes.get(id);
  if (!n) return;
  state.selected = id;
  state.query = "";
  $("search").value = "";
  state.branch = state.data.unplacedIds.includes(id)
    ? "unplaced"
    : n.branch || "all";
  $("branch").value = state.branch;
  ancestors(id).forEach((parent) => state.expanded.add(parent));
  if ($("person-dialog").open) $("person-dialog").close();
  render();
  requestAnimationFrame(() => {
    const target = findCard(id);
    if (state.view === "map") centerCard(target);
    else target?.scrollIntoView({ block: "center", behavior: "instant" });
    if (!$("person-dialog").open)
      target?.querySelector(".card-main")?.focus({ preventScroll: true });
  });
}
function detailSection(title, parent) {
  const section = el("section", "detail-section");
  section.append(el("h3", "", title));
  parent.append(section);
  return section;
}
function openDetails(id) {
  const n = state.nodes.get(id);
  if (!n) return;
  if (!$("person-dialog").open) dialogOpener = document.activeElement;
  state.selected = id;
  const content = $("detail-content");
  content.replaceChildren();
  const title = el(
    "h2",
    "",
    n.code
      ? `Register ${n.code}`
      : id === state.data.rootId
        ? "Common roots"
        : "Family entry",
  );
  title.id = "detail-title";
  content.append(title, el("p", "detail-label", relation(n)));
  const members = el("div", "detail-members");
  n.members.forEach((m) => members.append(memberView(m, true)));
  content.append(members);
  if (n.notes.length) {
    const section = detailSection("Family notes", content);
    n.notes.forEach((note) => section.append(el("p", "", note)));
  }
  const path = ancestors(id);
  if (path.length) {
    const section = detailSection("Path through the register", content),
      nav = el("nav", "ancestry");
    nav.setAttribute("aria-label", "Ancestor entries");
    path.forEach((pid, i) => {
      if (i) nav.append(el("span", "", "›"));
      nav.append(
        action(shortLabel(state.nodes.get(pid)), () => openDetails(pid)),
      );
    });
    section.append(nav);
  }
  if (n.children.length) {
    const section = detailSection("Children", content),
      links = el("div", "detail-links");
    n.children.forEach((cid) =>
      links.append(
        action(shortLabel(state.nodes.get(cid)), () => openDetails(cid)),
      ),
    );
    section.append(links);
  } else if (n.childrenStatus === "none") {
    const section = detailSection("Children", content);
    section.append(el("p", "", "No children."));
  }
  content.append(
    action("Show this entry in the tree", () => goTo(id), "primary-action"),
  );
  const copy = action("Copy link to this entry", async () => {
    const url = new URL(location.href);
    url.hash = "entry=" + encodeURIComponent(id);
    try {
      await navigator.clipboard.writeText(url.href);
      copy.textContent = "Link copied";
    } catch {
      const input = el("input");
      input.readOnly = true;
      input.value = url.href;
      input.setAttribute("aria-label", "Link to this entry");
      input.style.width = "100%";
      content.append(input);
      input.focus();
      input.select();
      copy.textContent = "Select and copy the link below";
    }
  });
  copy.style.marginTop = "10px";
  content.append(copy);
  if (!$("person-dialog").open) $("person-dialog").showModal();
  $("person-dialog").scrollTop = 0;
  $("close-dialog").focus({ preventScroll: true });
}
function applyTransform() {
  const container = $("tree-content");
  const stage = container.querySelector(".map-stage");
  if (!stage) return;
  stage.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.zoom})`;
  // The grid uses the same world origin and scale as the family diagram,
  // while still filling the viewport after long pans in any direction.
  container.style.setProperty("--grid-x", `${state.x}px`);
  container.style.setProperty("--grid-y", `${state.y}px`);
  container.style.setProperty("--grid-size", `${20 * state.zoom}px`);
  container.style.setProperty("--grid-dot", `${state.zoom}px`);
  $("zoom-level").textContent = Math.round(state.zoom * 100) + "%";
}
function zoomAt(factor, cx, cy) {
  const old = state.zoom,
    zoom = Math.max(0.015, Math.min(2.5, old * factor));
  state.x = cx - ((cx - state.x) * zoom) / old;
  state.y = cy - ((cy - state.y) * zoom) / old;
  state.zoom = zoom;
  applyTransform();
}
function zoomCenter(factor) {
  const c = $("tree-content");
  zoomAt(factor, c.clientWidth / 2, c.clientHeight / 2);
}
function fitMap() {
  const c = $("tree-content"),
    stage = c.querySelector(".map-stage");
  if (!stage) return;
  state.zoom = Math.min(
    1,
    Math.max(
      0.015,
      Math.min(
        c.clientWidth / stage.offsetWidth,
        c.clientHeight / stage.offsetHeight,
      ),
    ),
  );
  state.x = (c.clientWidth - stage.offsetWidth * state.zoom) / 2;
  state.y = (c.clientHeight - stage.offsetHeight * state.zoom) / 2;
  applyTransform();
}
function centerCard(card) {
  if (!card) return;
  state.zoom = 1;
  applyTransform();
  const c = $("tree-content"),
    rect = card.getBoundingClientRect(),
    box = c.getBoundingClientRect();
  state.x += box.left + c.clientWidth / 2 - rect.left - rect.width / 2;
  state.y += box.top + c.clientHeight / 2 - rect.top - rect.height / 2;
  applyTransform();
}
function setupPanZoom() {
  const c = $("tree-content"),
    pointers = new Map();
  let gesture = null,
    moved = false,
    suppressClickUntil = 0;
  const point = (e) => {
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const distance = (p) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  const midpoint = (p) => ({
    x: (p[0].x + p[1].x) / 2,
    y: (p[0].y + p[1].y) / 2,
  });
  function begin() {
    const p = [...pointers.values()];
    gesture =
      p.length > 1
        ? {
            mode: "pinch",
            center: midpoint(p),
            distance: distance(p),
            x: state.x,
            y: state.y,
            zoom: state.zoom,
          }
        : p.length
          ? { mode: "pan", point: p[0], x: state.x, y: state.y }
          : null;
  }
  c.addEventListener("pointerdown", (e) => {
    if (!c.classList.contains("diagram") || e.button !== 0) return;
    if (!pointers.size) {
      moved = false;
      // A fresh press is intentional, not the synthetic click ending a drag.
      suppressClickUntil = 0;
    }
    if (e.pointerType === "mouse" && e.target.closest("button")) return;
    pointers.set(e.pointerId, point(e));
    begin();
    // Touch cards remain tappable. Capture only after a drag is established.
    if (!e.target.closest("button")) c.setPointerCapture(e.pointerId);
  });
  c.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, point(e));
    const p = [...pointers.values()];
    if (gesture.mode === "pinch" && p.length > 1) {
      const center = midpoint(p),
        zoom = Math.max(
          0.015,
          Math.min(
            2.5,
            (gesture.zoom * distance(p)) / Math.max(1, gesture.distance),
          ),
        );
      state.x =
        center.x - ((gesture.center.x - gesture.x) * zoom) / gesture.zoom;
      state.y =
        center.y - ((gesture.center.y - gesture.y) * zoom) / gesture.zoom;
      state.zoom = zoom;
      moved = true;
    } else {
      const dx = p[0].x - gesture.point.x,
        dy = p[0].y - gesture.point.y;
      if (Math.hypot(dx, dy) > 5) moved = true;
      if (moved) {
        state.x = gesture.x + dx;
        state.y = gesture.y + dy;
      }
    }
    if (moved) {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      c.classList.add("panning");
      applyTransform();
    }
  });
  const finish = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
    if (moved) suppressClickUntil = Date.now() + 400;
    begin();
    if (!pointers.size) c.classList.remove("panning");
  };
  c.addEventListener("pointerup", finish);
  c.addEventListener("pointercancel", finish);
  c.addEventListener(
    "click",
    (e) => {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  c.addEventListener(
    "wheel",
    (e) => {
      if (!c.classList.contains("diagram") || !e.ctrlKey) return;
      e.preventDefault();
      const p = point(e);
      zoomAt(Math.exp(-e.deltaY * 0.008), p.x, p.y);
    },
    { passive: false },
  );
  c.addEventListener("keydown", (e) => {
    if (!c.classList.contains("diagram") || e.target !== c) return;
    const moves = {
      ArrowLeft: [50, 0],
      ArrowRight: [-50, 0],
      ArrowUp: [0, 50],
      ArrowDown: [0, -50],
    };
    if (moves[e.key]) {
      e.preventDefault();
      state.x += moves[e.key][0];
      state.y += moves[e.key][1];
      applyTransform();
    } else if (["+", "=", "-", "0"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "0") fitMap();
      else zoomCenter(e.key === "-" ? 1 / 1.2 : 1.2);
    }
  });
  let size = "";
  new ResizeObserver(() => {
    const next = `${c.clientWidth}:${c.clientHeight}`;
    if (next !== size) {
      size = next;
      if (c.classList.contains("diagram")) fitMap();
    }
  }).observe(c);
}
function followHash() {
  if (!location.hash.startsWith("#entry=")) return;
  let id;
  try {
    id = decodeURIComponent(location.hash.slice(7));
  } catch {
    return;
  }
  id = state.data.idRedirects?.[id] || id;
  if (state.nodes.has(id)) {
    goTo(id);
    openDetails(id);
  } else
    $("status").textContent =
      "That entry link was not found. You can search for a family member above.";
}
async function start() {
  try {
    const response = await fetch("family-data.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json(),
      validated = validate(data);
    state.data = data;
    state.nodes = validated.nodes;
    state.parents = validated.parents;
    // Match Collapse all: keep the common roots and A–G branch heads visible.
    state.expanded = new Set([data.rootId]);
    for (const n of data.nodes)
      n.searchText = normalize(
        [
          n.code,
          n.branch,
          ...n.members.flatMap((m) => [
            m.name,
            ...m.nicknames,
            ...m.alternateNames,
          ]),
        ].join(" "),
      );
    for (const id of state.nodes.get(data.rootId).children) {
      const n = state.nodes.get(id),
        option = el("option", "", `${n.branch} · ${n.members[0].name}`);
      option.value = n.branch;
      $("branch").append(option);
    }
    if (data.unplacedIds.length) {
      const pending = el(
        "option",
        "",
        `Other family entries (${data.unplacedIds.length})`,
      );
      pending.value = "unplaced";
      $("branch").append(pending);
    }
    // Full-data counts, independent of filtering, search and collapsed branches.
    // Each member counts once; their nicknames and aliases do not.
    const totalPeople = data.nodes.reduce(
      (total, node) => total + node.members.length,
      0,
    );
    const maxGenerations = data.nodes.reduce(
      (maximum, node) => Math.max(maximum, ancestors(node.id).length + 1),
      0,
    );
    [
      [
        state.nodes.get(data.rootId).children.length,
        "Family branches",
        "branches",
        "Branches beneath the common ancestors.",
      ],
      [
        totalPeople,
        "Total people",
        "people",
        "People across the full tree, including spouses. Nicknames and alternate names are not counted separately.",
      ],
      [
        maxGenerations,
        "Max. generations",
        "generations",
        "Longest lineage in the full tree, counting the common ancestors as generation 1.",
      ],
    ].forEach(([num, title, metric, description]) => {
      const stat = el("div", "stat");
      stat.dataset.metric = metric;
      stat.title = description;
      stat.setAttribute("role", "group");
      stat.setAttribute("aria-label", `${num} ${title}. ${description}`);
      stat.append(el("strong", "", num), el("span", "", title));
      $("stats").append(stat);
    });
    $("toolbar").hidden = false;
    $("tree-actions").hidden = false;
    $("search").addEventListener("input", (e) => {
      state.query = e.target.value;
      render();
    });
    $("clear-search").addEventListener("click", () => {
      state.query = "";
      $("search").value = "";
      render();
      $("search").focus();
    });
    $("branch").addEventListener("change", (e) => {
      state.branch = e.target.value;
      visibleRoots().forEach((id) => state.expanded.add(id));
      render();
      if (state.view === "map") fitMap();
    });
    for (const mode of ["list", "map"])
      $(mode + "-view").addEventListener("click", () => {
        state.view = mode;
        render();
        if (mode === "map") fitMap();
      });
    $("expand-all").addEventListener("click", () => {
      data.nodes.forEach((n) => {
        if (n.children.length) state.expanded.add(n.id);
      });
      render();
      if (state.view === "map") fitMap();
    });
    $("collapse-all").addEventListener("click", () => {
      state.expanded.clear();
      if (state.branch === "all") state.expanded.add(data.rootId);
      render();
      if (state.view === "map") fitMap();
    });
    $("zoom-in").addEventListener("click", () => zoomCenter(1.25));
    $("zoom-out").addEventListener("click", () => zoomCenter(0.8));
    $("fit-map").addEventListener("click", fitMap);
    $("reset-map").addEventListener("click", () => {
      state.zoom = 1;
      state.x = state.y = 20;
      applyTransform();
    });
    $("close-dialog").addEventListener("click", () =>
      $("person-dialog").close(),
    );
    $("person-dialog").addEventListener("close", () => {
      if (!$("person-dialog").open && dialogOpener?.isConnected)
        dialogOpener.focus({ preventScroll: true });
    });
    $("person-dialog").addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const controls = [
        ...$("person-dialog").querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]',
        ),
      ].filter((control) => control.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    });
    window.addEventListener("hashchange", followHash);
    setupPanZoom();
    render();
    fitMap();
    followHash();
  } catch (error) {
    $("status").textContent = "The family register could not be loaded.";
    const box = el("div", "error");
    box.append(
      el("h3", "", "Let’s reconnect to the family data"),
      el(
        "p",
        "",
        `${error.message} Serve this folder over HTTP rather than opening the HTML file directly. For example: python3 -m http.server 8000`,
      ),
    );
    box.append(action("Try again", () => location.reload()));
    $("tree-content").replaceChildren(box);
    $("toolbar").hidden = true;
    $("tree-actions").hidden = true;
  }
}
start();
