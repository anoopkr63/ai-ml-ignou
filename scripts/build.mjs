import { readdirSync, statSync, rmSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist");

const esc = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const href = (parts) => "/" + parts.map(encodeURIComponent).join("/");

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const byName = (a, b) => a.localeCompare(b, "en", { numeric: true });

const list = (dir) => readdirSync(dir).filter((n) => !n.startsWith(".")).sort(byName);
const isDir = (p) => statSync(p).isDirectory();

function toItem(parts) {
  const file = parts[parts.length - 1];
  const name = file.replace(/\.pdf$/i, "");
  const size = formatSize(statSync(join(ROOT, ...parts)).size);
  let m;
  if ((m = name.match(/^Unit-(\d+)\s+(.*)$/))) return { label: `Unit ${+m[1]}`, title: m[2], href: href(parts), size };
  if ((m = name.match(/^Section-(\d+)\s+(.*)$/))) return { label: `Section ${+m[1]}`, title: m[2], href: href(parts), size };
  if (/^00 Block-\d+ Introduction/.test(name)) return { label: "Intro", title: "Block introduction", href: href(parts), size };
  return { label: "", title: name, href: href(parts), size };
}

function readCourse(semDir, dir) {
  const m = dir.match(/^(\S+)\s+(.*)$/);
  const groups = [];
  const loose = [];
  for (const entry of list(join(ROOT, semDir, dir))) {
    if (isDir(join(ROOT, semDir, dir, entry))) {
      const b = entry.match(/^Block-(\d+)\s+(.*)$/);
      const items = list(join(ROOT, semDir, dir, entry))
        .filter((f) => f.toLowerCase().endsWith(".pdf"))
        .map((f) => toItem([semDir, dir, entry, f]));
      groups.push({ heading: b ? `Block ${+b[1]} · ${b[2]}` : entry, items });
    } else if (entry.toLowerCase().endsWith(".pdf")) {
      loose.push(toItem([semDir, dir, entry]));
    }
  }
  if (loose.length) groups.unshift({ items: loose });
  return { code: m[1], title: m[2], groups, count: groups.reduce((n, g) => n + g.items.length, 0) };
}

function readAssignments(semDir) {
  return list(join(ROOT, semDir, "Assignments"))
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => ({ ...toItem([semDir, "Assignments", f]), code: f.split(" ")[0] }));
}

const semesters = list(ROOT)
  .filter((d) => /^Semester-/.test(d) && isDir(join(ROOT, d)))
  .map((d) => {
    const dirs = list(join(ROOT, d)).filter((e) => isDir(join(ROOT, d, e)));
    return {
      dir: d,
      id: d.toLowerCase(),
      name: d.replace("-", " "),
      courses: dirs.filter((e) => e !== "Assignments").map((e) => readCourse(d, e)),
      assignments: dirs.includes("Assignments") ? readAssignments(d) : [],
    };
  });

const courseTitles = new Map(semesters.flatMap((s) => s.courses.map((c) => [c.code, c.title])));

const pdfIcon = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h6.5L15.5 6.5V17a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M11.5 2.5v4h4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
const dlIcon = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v9m0 0-3.5-3.5M10 12.5l3.5-3.5M4 16h12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const renderItem = (i) => `
        <li class="item" data-search="${esc(`${i.label} ${i.title}`.toLowerCase())}">
          <a class="item-link" href="${i.href}" target="_blank" rel="noopener">
            ${pdfIcon}
            ${i.label ? `<span class="item-label">${esc(i.label)}</span>` : ""}
            <span class="item-title">${esc(i.title)}</span>
          </a>
          <span class="item-size">${i.size}</span>
          <a class="item-dl" href="${i.href}" download title="Download ${esc(i.title)}" aria-label="Download ${esc(i.title)}">${dlIcon}</a>
        </li>`;

const renderCourse = (c) => `
    <section class="course" id="${esc(c.code.toLowerCase())}" data-search="${esc(`${c.code} ${c.title}`.toLowerCase())}">
      <header class="course-head">
        <span class="course-code">${esc(c.code)}</span>
        <h3>${esc(c.title)}</h3>
        <span class="course-count">${c.count} ${c.count === 1 ? "file" : "files"}</span>
      </header>
      ${c.groups
        .map(
          (g) => `<div class="group">
        ${g.heading ? `<h4>${esc(g.heading)}</h4>` : ""}
        <ul>${g.items.map(renderItem).join("")}
        </ul>
      </div>`,
        )
        .join("\n      ")}
    </section>`;

const renderAssignments = (items) => `
    <section class="course" data-search="assignments">
      <header class="course-head">
        <h3>Assignments</h3>
        <span class="course-count">${items.length} ${items.length === 1 ? "file" : "files"}</span>
      </header>
      <div class="group">
        <ul>${items
          .map((a) => renderItem({ ...a, label: a.code, title: courseTitles.get(a.code) ?? a.title }))
          .join("")}
        </ul>
      </div>
    </section>`;

const body = semesters
  .map(
    (s) => `
  <section class="semester" id="${s.id}">
    <h2>${esc(s.name)}</h2>
    ${s.courses.map(renderCourse).join("\n")}
    ${s.assignments.length ? renderAssignments(s.assignments) : ""}
  </section>`,
  )
  .join("\n");

const nav = semesters.map((s) => `<a href="#${s.id}">${esc(s.name)}</a>`).join("");
const totalFiles = semesters.reduce(
  (n, s) => n + s.courses.reduce((m, c) => m + c.count, 0) + s.assignments.length,
  0,
);

const html = readFileSync(join(ROOT, "src/index.html"), "utf8")
  .replace("{{NAV}}", nav)
  .replace("{{CONTENT}}", body)
  .replace("{{TOTAL}}", String(totalFiles))
  .replace("{{COURSES}}", String(semesters.reduce((n, s) => n + s.courses.length, 0)));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
writeFileSync(join(OUT, "index.html"), html);
cpSync(join(ROOT, "src/style.css"), join(OUT, "style.css"));
cpSync(join(ROOT, "src/app.js"), join(OUT, "app.js"));
for (const s of semesters) {
  cpSync(join(ROOT, s.dir), join(OUT, s.dir), { recursive: true, filter: (src) => !/[\\/]Solutions$/.test(src) });
}

console.log(`Built ${totalFiles} files across ${semesters.length} semesters into dist/`);
