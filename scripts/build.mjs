import { readdirSync, statSync, rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist");

const passphrase = process.env.PLAN_PASSPHRASE;
const PLAN_SRC = join(ROOT, "scripts/plan-data.mjs");
const PLAN_SEALED = join(ROOT, "scripts/plan-data.sealed");

const unb64 = (s) => Uint8Array.from(Buffer.from(s, "base64"));

async function deriveKey(passphrase, salt, iterations, usage) {
  const base = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

async function loadPlan() {
  if (existsSync(PLAN_SRC)) return import(pathToFileURL(PLAN_SRC).href);
  if (!existsSync(PLAN_SEALED) || !passphrase) return null;
  const sealed = JSON.parse(readFileSync(PLAN_SEALED, "utf8"));
  const key = await deriveKey(passphrase, unb64(sealed.salt), sealed.iter, "decrypt");
  const plain = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, key, unb64(sealed.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

const plan = await loadPlan();

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

const GUIDES = "Study Guides";

// Bilingual study guides, one per block, keyed by course code for the plan page.
// Only the semester folders are read; anything else under Study Guides is not
// course material and stays out of the site.
function readGuides() {
  const byCourse = new Map();
  if (!existsSync(join(ROOT, GUIDES))) return byCourse;
  for (const sem of list(join(ROOT, GUIDES)).filter((d) => /^Semester-/.test(d) && isDir(join(ROOT, GUIDES, d)))) {
    for (const course of list(join(ROOT, GUIDES, sem)).filter((d) => isDir(join(ROOT, GUIDES, sem, d)))) {
      const items = list(join(ROOT, GUIDES, sem, course))
        .filter((f) => f.toLowerCase().endsWith(".pdf"))
        .map((f) => {
          const parts = [GUIDES, sem, course, f];
          const name = f.replace(/\.pdf$/i, "").replace(/\s*-\s*Study Guide.*$/i, "");
          const b = name.match(/^Block-(\d+)/);
          return {
            block: b ? +b[1] : null,
            title: name,
            href: href(parts),
            size: formatSize(statSync(join(ROOT, ...parts)).size),
          };
        });
      if (items.length) {
        byCourse.set(course.split(" ")[0], items);
        guideDirs.add(sem);
      }
    }
  }
  return byCourse;
}

const guideDirs = new Set();
const guides = readGuides();

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
const chevron = `<svg class="chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const renderItem = (i) => `
        <li class="item" data-search="${esc(`${i.label} ${i.title}`.toLowerCase())}">
          <a class="item-link" href="${i.href}" target="_blank" rel="noopener" title="Read ${esc(i.title)}">
            ${pdfIcon}
            ${i.label ? `<span class="item-label">${esc(i.label)}</span>` : ""}
            <span class="item-title">${esc(i.title)}</span>
          </a>
          <span class="item-size">${i.size}</span>
          <a class="item-dl" href="${i.href}" download title="Download ${esc(i.title)}" aria-label="Download ${esc(i.title)}">${dlIcon}</a>
        </li>`;

const renderCourse = (c) => `
    <details class="course" id="${esc(c.code.toLowerCase())}" data-search="${esc(`${c.code} ${c.title}`.toLowerCase())}">
      <summary class="course-head">
        <span class="course-code">${esc(c.code)}</span>
        <h3>${esc(c.title)}</h3>
        <span class="course-count">${c.count} ${c.count === 1 ? "file" : "files"}</span>
        ${chevron}
      </summary>
      ${c.groups
        .map(
          (g) => `<div class="group">
        ${g.heading ? `<h4>${esc(g.heading)}</h4>` : ""}
        <ul>${g.items.map(renderItem).join("")}
        </ul>
      </div>`,
        )
        .join("\n      ")}
    </details>`;

const renderAssignments = (items) => `
    <details class="course" data-search="assignments">
      <summary class="course-head">
        <h3>Assignments</h3>
        <span class="course-count">${items.length} ${items.length === 1 ? "file" : "files"}</span>
        ${chevron}
      </summary>
      <div class="group">
        <ul>${items
          .map((a) => renderItem({ ...a, label: a.code, title: courseTitles.get(a.code) ?? a.title }))
          .join("")}
        </ul>
      </div>
    </details>`;

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


/* Study plan page */
const PBKDF2_ITERATIONS = 600000;

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

async function encryptPlan(plaintext, passphrase) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS, "encrypt");
  const ct = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return { v: 1, iter: PBKDF2_ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}


const renderTask = (t) => `
            <li class="task">
              <input type="checkbox" id="${esc(t.id)}">
              <label for="${esc(t.id)}">${esc(t.text)}${t.note ? `<span class="task-note">${esc(t.note)}</span>` : ""}</label>
            </li>`;

const renderDay = (b) => `
        <details class="day${b.exam ? " day-exam" : ""}" data-start="${b.start}" data-end="${b.end}">
          <summary class="day-head">
            <span class="day-when">${esc(b.label)}</span>
            <span class="day-what">${esc(b.dates)}</span>
            <span class="day-count"></span>
            ${chevron}
          </summary>
          ${b.goal ? `<p class="day-goal">${esc(b.goal)}</p>` : ""}
          <ul class="tasks">${b.tasks.map(renderTask).join("")}
          </ul>
        </details>`;

const groupWeeks = (blocks) => {
  const weeks = [];
  for (const b of blocks) {
    if (b.week || !weeks.length) weeks.push({ label: b.week ?? "", days: [] });
    weeks[weeks.length - 1].days.push(b);
  }
  return weeks;
};

const renderWeek = (w) => `
      <details class="week">
        <summary class="week-head">
          <span class="week-label">${esc(w.label)}</span>
          <span class="week-count"></span>
          ${chevron}
        </summary>
        ${w.days.map(renderDay).join("")}
      </details>`;

const renderPhase = (p) => `
    <details class="phase" id="${esc(p.id)}">
      <summary class="phase-head">
        <h2>${esc(p.name)}</h2>
        <span class="phase-range">${esc(p.range)}</span>
        <div class="phase-bar bar">
          <span class="bar-track"><span class="bar-fill"></span></span>
          <span class="bar-count"></span>
        </div>
        ${chevron}
      </summary>
      <p class="phase-intro">${esc(p.intro)}</p>
      ${groupWeeks(p.blocks).map(renderWeek).join("")}
    </details>`;

const renderExams = () => `
    <section class="plan-block" id="calendar">
      <h2>Exam calendar</h2>
      <div class="table-scroll">
        <table class="exam-table">
          <thead><tr><th>Date</th><th>Course</th><th>Title</th><th>Session</th></tr></thead>
          <tbody>${plan.exams
            .map(
              (e) => `
            <tr>
              <td class="exam-when">${esc(e.day)}${e.date ? ` <span class="countdown" data-countdown="${e.date}"></span>` : ""}</td>
              <td class="exam-code">${esc(e.code)}</td>
              <td>${esc(e.title)}</td>
              <td class="exam-sess">${esc(e.session)}</td>
            </tr>`,
            )
            .join("")}
          </tbody>
        </table>
      </div>
      <p class="plan-note">The September release is tentative — verify against your hall ticket, and confirm your exam form is in.</p>
    </section>`;

const renderBlockRow = ([name, pp], i, courseGuides) => {
  const guide = courseGuides.find((g) => g.block === i + 1);
  const label = guide
    ? `<a href="${guide.href}" target="_blank" rel="noopener" title="Study guide · ${esc(guide.title)} · ${guide.size}">${esc(name)}</a>`
    : `<span>${esc(name)}</span>`;
  return `<li>${label}<span class="pp">${esc(pp)}</span></li>`;
};

const renderCourseGuide = (c) => `
      <details class="course">
        <summary class="course-head">
          <span class="course-code">${esc(c.code)}</span>
          <h3>${esc(c.title)}</h3>
          <span class="course-count">${esc(c.meta)}</span>
          ${chevron}
        </summary>
        <div class="guide">
          <h4>Highest return first</h4>
          <ol class="ranked">${c.priorities
            .map(([head, rest]) => `<li><strong>${esc(head)}</strong> — ${esc(rest)}</li>`)
            .join("")}
          </ol>
          <h4>Block map${guides.has(c.code) ? " — linked to the study guides" : ""}</h4>
          <ul class="blockmap">${c.blockMap
            .map((row, i) => renderBlockRow(row, i, guides.get(c.code) ?? []))
            .join("")}
          </ul>
          <h4>How to study it</h4>
          <p>${esc(c.method)}</p>
        </div>
      </details>`;

const renderPyq = (q) => `
      <details class="course">
        <summary class="course-head">
          <span class="course-code">${esc(q.code)}</span>
          <h3>${esc(q.papers)}</h3>
          ${chevron}
        </summary>
        <div class="guide">
          <p class="proxy">${esc(q.proxies)}</p>
          <ul class="freq">${q.topics
            .map(([topic, freq]) => `<li><span>${esc(topic)}</span><span class="freq-n">${esc(freq)}</span></li>`)
            .join("")}
          </ul>
        </div>
      </details>`;

const planBody = !plan
  ? null
  : `
    <section class="plan-intro">
      <h1>Semester-I study plan</h1>
      <p class="plan-lede">Four theory papers from 25 November to 8 December 2026, two practicals after. Fifty-one days, built for 90 minutes on weekdays and about four hours each weekend day.</p>
      <div class="overall bar">
        <span class="bar-label">Overall</span>
        <span class="bar-track"><span class="bar-fill"></span></span>
        <span class="bar-count"></span>
        <button class="toggle-all expand" type="button">Expand all</button>
        <button class="toggle-all reset" type="button">Reset progress</button>
      </div>
    </section>
${renderExams()}
${plan.phases.map(renderPhase).join("\n")}
    <section class="plan-block" id="courses">
      <h2>What to study, and what to skim</h2>
      <p class="plan-note">Roughly 1,210 pages across the four theory courses — too many to read linearly at this pace, and attempting it is the main way people fail. The bilingual guides are the primary read; the block PDFs are reference.</p>
${plan.courses.map(renderCourseGuide).join("\n")}
    </section>
    <section class="plan-block" id="papers">
      <h2>Past papers</h2>
      ${plan.pyqIntro.map((t) => `<p class="plan-note">${esc(t)}</p>`).join("")}
${plan.pyq.map(renderPyq).join("\n")}
    </section>
    <section class="plan-block" id="method">
      <h2>How to spend 90 minutes</h2>
      <ul class="routine">${plan.routine
        .map(([t, what]) => `<li><span class="slot-time">${esc(t)}</span><span>${esc(what)}</span></li>`)
        .join("")}
      </ul>
      <ul class="rules">${plan.rules.map((r) => `<li>${esc(r)}</li>`).join("")}
      </ul>
    </section>
    <section class="plan-block" id="sources">
      <h2>Sources</h2>
      <ul class="rules">${plan.sources
        .map((s) => `<li><a href="${s.href}" target="_blank" rel="noopener">${esc(s.text)}</a></li>`)
        .join("")}
      </ul>
      <p class="plan-note">${esc(plan.footnote)}</p>
    </section>`;

const unlockShell = (payload) => `
    <section class="plan-intro">
      <h1>Semester-I study plan</h1>
      <p class="plan-lede">This plan is encrypted. It is decrypted in your browser — the passphrase is never sent anywhere.</p>
      <form class="unlock">
        <input type="password" id="passphrase" autocomplete="current-password" placeholder="Passphrase" aria-label="Passphrase" required>
        <button type="submit">Unlock</button>
        <p class="unlock-error" hidden>That passphrase does not match.</p>
      </form>
    </section>
    <div class="vault" hidden></div>
    <script type="application/json" class="payload">${JSON.stringify(payload).replace(/</g, "\\u003c")}<\/script>`;

// No visible entry point: a hidden anchor the keyboard shortcut in app.js reads.
// It is only emitted when the plan is actually built, so the shortcut is inert otherwise.
const planLink = `<a class="plan-key" href="/plan.html" hidden tabindex="-1" aria-hidden="true"></a>`;

const planHtml =
  planBody && passphrase
    ? readFileSync(join(ROOT, "src/plan.html"), "utf8").replace(
        "{{PLAN}}",
        unlockShell(await encryptPlan(planBody, passphrase)),
      )
    : null;

const html = readFileSync(join(ROOT, "src/index.html"), "utf8")
  .replace("{{PLANLINK}}", planHtml ? planLink : "")
  .replace("{{NAV}}", nav)
  .replace("{{CONTENT}}", body);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
writeFileSync(join(OUT, "index.html"), html);
if (planHtml) {
  writeFileSync(join(OUT, "plan.html"), planHtml);
  cpSync(join(ROOT, "src/plan.js"), join(OUT, "plan.js"));
}
cpSync(join(ROOT, "src/style.css"), join(OUT, "style.css"));
cpSync(join(ROOT, "src/app.js"), join(OUT, "app.js"));
cpSync(join(ROOT, "src/theme.js"), join(OUT, "theme.js"));
cpSync(join(ROOT, "src/reader.js"), join(OUT, "reader.js"));
for (const s of semesters) {
  cpSync(join(ROOT, s.dir), join(OUT, s.dir), { recursive: true, filter: (src) => !/[\\/]Solutions$/.test(src) });
}
if (planHtml) {
  for (const d of guideDirs) cpSync(join(ROOT, GUIDES, d), join(OUT, GUIDES, d), { recursive: true });
}

const planTasks = (plan?.phases ?? []).reduce((n, p) => n + p.blocks.reduce((m, b) => m + b.tasks.length, 0), 0);
const guideFiles = [...guides.values()].reduce((n, g) => n + g.length, 0);

console.log(
  planHtml
    ? `Built ${totalFiles} files across ${semesters.length} semesters, plus an encrypted study plan of ${planTasks} tasks linking ${guideFiles} study guides, into dist/`
    : `Built ${totalFiles} files across ${semesters.length} semesters into dist/. PLAN_PASSPHRASE is not set, so the study plan was NOT built.`,
);
