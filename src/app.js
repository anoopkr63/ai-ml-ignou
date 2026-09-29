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
  } else if (e.key === "Escape" && document.activeElement === input) {
    input.value = "";
    input.dispatchEvent(new Event("input"));
    input.blur();
  }
});

document.querySelector(".theme").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("theme", root.dataset.theme); } catch {}
});
