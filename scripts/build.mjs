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

const PAPERS = "Previous Year Questions";

// Term-end papers, one folder per course, named by the session printed inside the PDF.
const sessionKey = (name) => {
  const m = name.match(/(June|December)\s+(\d{4})/i);
  if (!m) return 0;
  return +m[2] * 10 + (/^dec/i.test(m[1]) ? 2 : 1);
};

function readPaperCourse(semDir, dir) {
  const m = dir.match(/^(\S+)\s+(.*)$/);
  const items = list(join(ROOT, PAPERS, semDir, dir))
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => {
      const parts = [PAPERS, semDir, dir, f];
      const name = f.replace(/\.pdf$/i, "");
      return {
        sort: sessionKey(name),
        label: "",
        title: name.replace(/^\S+\s+/, ""),
        href: href(parts),
        size: formatSize(statSync(join(ROOT, ...parts)).size),
      };
    })
    .sort((a, b) => b.sort - a.sort || byName(a.title, b.title));
  return {
    id: `pyq-${m[1].toLowerCase()}`,
    code: m[1],
    title: m[2],
    groups: items.length ? [{ items }] : [],
    count: items.length,
  };
}

function readPapers() {
  if (!existsSync(join(ROOT, PAPERS))) return [];
  return list(join(ROOT, PAPERS))
    .filter((d) => /^Semester-/.test(d) && isDir(join(ROOT, PAPERS, d)))
    .map((d) => ({
      name: d.replace("-", " "),
      courses: list(join(ROOT, PAPERS, d))
        .filter((e) => isDir(join(ROOT, PAPERS, d, e)))
        .map((e) => readPaperCourse(d, e))
        .filter((c) => c.count),
    }))
    .filter((s) => s.courses.length);
}

const papers = readPapers();

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

const PREP = "Exam Preparation";

// Solved question banks. Private, like the plan: they are only linked from inside the
// encrypted plan body and only copied into dist when the plan is built.
function readPrep() {
  if (!existsSync(join(ROOT, PREP))) return [];
  return list(join(ROOT, PREP))
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => {
      const parts = [PREP, f];
      const m = f.replace(/\.pdf$/i, "").match(/^(\S+)\s+(.*)$/);
      return {
        label: m[1],
        title: m[2],
        href: href(parts),
        size: formatSize(statSync(join(ROOT, ...parts)).size),
      };
    });
}

const prep = readPrep();

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

/* A day in the plan names its material as "MCS-061 · Unit 1", "MCS-208 · Block 3" or
   "MCS-061 · timed paper". Unit numbers run on across blocks, so that text resolves to the
   PDFs already scanned above and the topic in the day header can open them. */
const materialByCode = new Map();
for (const s of semesters) {
  for (const c of s.courses) {
    const units = new Map();
    const blocks = new Map();
    for (const g of c.groups) {
      const b = g.heading?.match(/^Block (\d+)/);
      const own = [];
      for (const i of g.items) {
        const u = i.label.match(/^Unit (\d+)$/);
        if (u) units.set(+u[1], i);
        if (u || /^Section \d+$/.test(i.label)) own.push(i);
      }
      if (b) blocks.set(+b[1], own);
    }
    materialByCode.set(c.code, { units, blocks });
  }
}

const papersByCode = new Map(papers.flatMap((s) => s.courses.map((c) => [c.code, c.groups[0].items])));
const prepByCode = new Map(prep.map((p) => [p.label, p]));

const MAX_DAY_LINKS = 4;

function dayLinks(b) {
  const m = String(b.dates).match(/^(\S+)\s*·\s*(.+)$/);
  if (!m) return [];
  const [, code, what] = m;
  if (b.exam) return []; // an exam day has nothing to open

  const material = materialByCode.get(code);
  const span = (word) => what.match(new RegExp(`${word}s?\\s+(\\d+)(?:\\s*[–-]\\s*(\\d+))?`, "i"));
  const range = (hit) => {
    const from = +hit[1];
    const to = hit[2] ? +hit[2] : from;
    return Array.from({ length: to - from + 1 }, (_, k) => from + k);
  };
  const fallback = () => {
    const bank = prepByCode.get(code);
    if (bank) return [{ label: "Question bank", title: bank.title, href: bank.href }];
    return materialByCode.has(code) ? [{ label: what, title: courseTitles.get(code), href: `/#${code.toLowerCase()}` }] : [];
  };

  let hit;
  if (material && (hit = span("unit"))) {
    const found = range(hit).map((n) => material.units.get(n)).filter(Boolean);
    if (found.length) return found.slice(0, MAX_DAY_LINKS);
  }
  if (material && (hit = span("block"))) {
    const nums = range(hit);
    if (nums.length === 1) {
      const found = material.blocks.get(nums[0]) ?? [];
      if (found.length) return found.slice(0, MAX_DAY_LINKS);
    }
    return fallback();
  }
  if (/timed paper/i.test(what)) {
    const found = (papersByCode.get(code) ?? []).slice(0, 2);
    if (found.length) return found.map((p) => ({ label: p.title, title: p.title, href: p.href }));
  }
  return fallback();
}

const pdfIcon = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h6.5L15.5 6.5V17a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M11.5 2.5v4h4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
const dlIcon = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v9m0 0-3.5-3.5M10 12.5l3.5-3.5M4 16h12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const outIcon = `<svg class="out" viewBox="0 0 20 20" aria-hidden="true"><path d="M11 5h4v4M14.5 5.5 9 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 12v2.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5H8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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
    <details class="course" id="${esc(c.id ?? c.code.toLowerCase())}" data-search="${esc(`${c.code} ${c.title}`.toLowerCase())}">
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
    (s, i) => `
  <section class="panel semester${i === 0 ? " active" : ""}" id="${s.id}">
    <h2>${esc(s.name)}</h2>
    ${s.courses.map(renderCourse).join("\n")}
    ${s.assignments.length ? renderAssignments(s.assignments) : ""}
  </section>`,
  )
  .join("\n");

const papersBody = !papers.length
  ? ""
  : `
  <section class="panel papers" id="past-papers">
    <h2>Previous year questions</h2>
${papers
  .map(
    (s) => `    <h3 class="papers-sem">${esc(s.name)}</h3>
${s.courses.map(renderCourse).join("\n")}`,
  )
  .join("\n")}
  </section>`;

const nav = [
  ...semesters.map((s) => `<a class="tab" href="#${s.id}">${esc(s.name)}</a>`),
  ...(papers.length ? [`<a class="tab" href="#past-papers">Past papers</a>`] : []),
].join("");
const paperFiles = papers.reduce((n, s) => n + s.courses.reduce((m, c) => m + c.count, 0), 0);
const totalFiles =
  semesters.reduce((n, s) => n + s.courses.reduce((m, c) => m + c.count, 0) + s.assignments.length, 0) + paperFiles;


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

const dayTopic = (b) => {
  const links = dayLinks(b);
  if (!links.length) return `<span class="day-what">${esc(b.dates)}</span>`;
  const anchor = (l, text) =>
    `<a class="day-link" href="${l.href}" target="_blank" rel="noopener" title="Open ${esc(l.title || text)}">${esc(text)}${outIcon}</a>`;
  if (links.length === 1) return `<span class="day-what">${anchor(links[0], b.dates)}</span>`;
  const prefix = String(b.dates).split("·")[0].trim();
  return `<span class="day-what">${esc(prefix)} · ${links.map((l) => anchor(l, l.label)).join("")}</span>`;
};

const renderDay = (b) => `
        <details class="day${b.exam ? " day-exam" : ""}" data-start="${b.start}" data-end="${b.end}">
          <summary class="day-head">
            <span class="day-when">${esc(b.label)}</span>
            ${dayTopic(b)}
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
      ${groupWeeks(p.blocks).map(renderWeek).join("")}
    </details>`;

const renderExams = () => `
    <section class="plan-block panel" id="calendar">
      <h2>Exam dates</h2>
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
    </section>`;

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
          <h4>Block map</h4>
          <ul class="blockmap">${c.blockMap
            .map(([name, pp]) => `<li><span>${esc(name)}</span><span class="pp">${esc(pp)}</span></li>`)
            .join("")}
          </ul>
        </div>
      </details>`;

const renderPrep = () => `
      <h3 class="plan-sub">Solved past questions</h3>
      <p class="plan-note">Every question from the previous papers, with worked answers.</p>
      <div class="course">
        <div class="group">
          <ul>${prep.map(renderItem).join("")}
          </ul>
        </div>
      </div>`;

const renderGuideCourse = ([code, items]) => `
      <details class="course">
        <summary class="course-head">
          <span class="course-code">${esc(code)}</span>
          <h3>${esc(courseTitles.get(code) ?? "")}</h3>
          <span class="course-count">${items.length} ${items.length === 1 ? "guide" : "guides"}</span>
          ${chevron}
        </summary>
        <div class="group">
          <ul>${items
            .map((g) =>
              renderItem({
                href: g.href,
                size: g.size,
                label: g.block ? `Block ${g.block}` : "",
                title: g.title.replace(/^Block-\d+\s+/, ""),
              }),
            )
            .join("")}
          </ul>
        </div>
      </details>`;

const renderGuides = () => `
      <h3 class="plan-sub">Block study guides</h3>
      <p class="plan-note">One guide per block, per course.</p>
${[...guides].map(renderGuideCourse).join("\n")}`;

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

const planNav = [
  ["#calendar", "Exam dates"],
  ["#timeline", "Day-by-day plan"],
  ["#courses", "What to study"],
  ["#papers", "What papers ask"],
  ...(prep.length || guides.size ? [["#material", "Download"]] : []),
  ["#sources", "Sources"],
]
  .map(([h, t]) => `<a class="tab" href="${h}">${t}</a>`)
  .join("");

const planBody = !plan
  ? null
  : `
    <section class="plan-intro">
      <h1>Semester-I study plan</h1>
      <div class="overall bar">
        <span class="bar-label">Overall</span>
        <span class="bar-track"><span class="bar-fill"></span></span>
        <span class="bar-count"></span>
        <button class="toggle-all expand" type="button">Expand all</button>
        <button class="toggle-all reset" type="button">Reset progress</button>
        <span class="sync" aria-live="polite"></span>
      </div>
      <nav class="plan-nav">${planNav}</nav>
    </section>
${renderExams()}
    <section class="plan-block panel active" id="timeline">
      <h2>Day-by-day plan</h2>
      <p class="plan-note">Four phases, split into weeks and days. Today's block opens by itself; tick a task to record it on this device.</p>
${plan.phases.map(renderPhase).join("\n")}
    </section>
    <section class="plan-block panel" id="courses">
      <h2>What to study, and what to skim</h2>
      <p class="plan-note">Per course: the topics worth the most marks, and how the blocks map to the paper.</p>
${plan.courses.map(renderCourseGuide).join("\n")}
    </section>
    <section class="plan-block panel" id="papers">
      <h2>What the past papers ask</h2>
      <p class="plan-note">Topic frequency across previous term-end papers, by course.</p>
${plan.pyq.map(renderPyq).join("\n")}
    </section>
${
      prep.length || guides.size
        ? `    <section class="plan-block panel" id="material">
      <h2>Download</h2>
${prep.length ? renderPrep() : ""}${guides.size ? renderGuides() : ""}
    </section>`
        : ""
    }
    <section class="plan-block panel" id="sources">
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
  .replace("{{CONTENT}}", body + papersBody);

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
if (papers.length) cpSync(join(ROOT, PAPERS), join(OUT, PAPERS), { recursive: true, filter: (src) => !/\.md$/i.test(src) });
for (const s of semesters) {
  cpSync(join(ROOT, s.dir), join(OUT, s.dir), { recursive: true, filter: (src) => !/[\\/]Solutions$/.test(src) });
}
if (planHtml) {
  for (const d of guideDirs) cpSync(join(ROOT, GUIDES, d), join(OUT, GUIDES, d), { recursive: true });
  if (prep.length) cpSync(join(ROOT, PREP), join(OUT, PREP), { recursive: true });
}

const planTasks = (plan?.phases ?? []).reduce((n, p) => n + p.blocks.reduce((m, b) => m + b.tasks.length, 0), 0);
const guideFiles = [...guides.values()].reduce((n, g) => n + g.length, 0);

console.log(
  planHtml
    ? `Built ${totalFiles} files across ${semesters.length} semesters, plus an encrypted study plan of ${planTasks} tasks linking ${guideFiles} study guides, into dist/`
    : `Built ${totalFiles} files across ${semesters.length} semesters into dist/. PLAN_PASSPHRASE is not set, so the study plan was NOT built.`,
);
