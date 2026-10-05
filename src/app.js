const input = document.querySelector(".search input");
const empty = document.querySelector(".empty");

input.addEventListener("input", () => {
  const q = input.value.trim().toLowerCase();
  let any = false;
  for (const course of document.querySelectorAll(".course")) {
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
    if (shown) any = true;
  }
  for (const sem of document.querySelectorAll(".semester")) {
    sem.hidden = !sem.querySelector(".course:not([hidden])");
  }
  empty.hidden = any;
});

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
    input.dispatchEvent(new Event("input"));
    input.blur();
  }
});

const toggleAll = document.querySelector(".toggle-all");
const courses = [...document.querySelectorAll(".course")];
const syncToggle = () => {
  toggleAll.textContent = courses.some((c) => c.open) ? "Collapse all" : "Expand all";
};

toggleAll.addEventListener("click", () => {
  const open = !courses.some((c) => c.open);
  for (const c of courses) c.open = open;
  syncToggle();
});
document.addEventListener("toggle", syncToggle, true);
