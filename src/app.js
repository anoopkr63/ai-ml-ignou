const input = document.querySelector(".search input");
const empty = document.querySelector(".empty");
const toggleAll = document.querySelector(".toggle-all");

const tabs = [...document.querySelectorAll(".tabs .tab")];
const panels = [...document.querySelectorAll(".panel")];
const current = () => panels.find((p) => p.classList.contains("active")) ?? panels[0];

// Hides everything in one panel that does not match the query, and reports how
// many of its courses survived.
const match = (panel, q) => {
  let visible = 0;
  for (const course of panel.querySelectorAll(".course")) {
    const courseHit = !q || course.dataset.search.includes(q);
    let shown = 0;
    for (const item of course.querySelectorAll(".item")) {
      const hit = courseHit || item.dataset.search.includes(q);
      item.hidden = !hit;
      if (hit) shown++;
    }
    for (const group of course.querySelectorAll(".group")) {
      group.hidden = !group.querySelector(".item:not([hidden])");
    }
    course.hidden = shown === 0;
    if (q && shown) course.open = true;
    if (shown) visible++;
  }
  return visible;
};

const select = (panel) => {
  for (const p of panels) p.classList.toggle("active", p === panel);
  for (const t of tabs) {
    if (t.hash === `#${panel.id}`) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  }
};

const syncToggle = () => {
  toggleAll.textContent = [...current().querySelectorAll(".course")].some((c) => c.open)
    ? "Collapse all"
    : "Expand all";
};

const filter = () => {
  const q = input.value.trim().toLowerCase();
  const counts = new Map(panels.map((p) => [p, match(p, q)]));
  let panel = current();
  // A search that only matches another tab jumps to it rather than showing nothing.
  if (q && !counts.get(panel)) {
    const hit = panels.find((p) => counts.get(p));
    if (hit) {
      panel = hit;
      history.replaceState(null, "", `#${panel.id}`);
    }
  }
  select(panel);
  empty.hidden = !!counts.get(panel);
  syncToggle();
};

const show = (id) => {
  select(panels.find((p) => p.id === id) ?? panels[0]);
  filter();
};

show(location.hash.slice(1));
window.addEventListener("hashchange", () => show(location.hash.slice(1)));

input.addEventListener("input", filter);

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== input) {
    e.preventDefault();
    input.focus();
  } else if (document.body.classList.contains("reader-open")) {
    // the reader handles its own keys
  } else if (e.key === "p" && document.activeElement !== input && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const plan = document.querySelector(".plan-key");
    if (plan) location.href = plan.href;
  } else if (e.key === "Escape" && document.activeElement === input) {
    input.value = "";
    filter();
    input.blur();
  }
});

toggleAll.addEventListener("click", () => {
  const courses = [...current().querySelectorAll(".course")];
  const open = !courses.some((c) => c.open);
  for (const c of courses) c.open = open;
  syncToggle();
});
document.addEventListener("toggle", syncToggle, true);
