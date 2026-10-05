const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
const MAX_WIDTH = 1100;

const overlay = document.querySelector(".reader");
const stage = overlay.querySelector(".reader-stage");
const titleEl = overlay.querySelector(".reader-title");
const countEl = overlay.querySelector(".reader-count");
const statusEl = overlay.querySelector(".reader-status");
const tabEl = overlay.querySelector(".reader-tab");
const dlEl = overlay.querySelector(".reader-dl");
const closeEl = overlay.querySelector(".reader-close");

let libPromise = null;
let doc = null;
let pages = [];
let zoom = 1;
let token = 0;
let lastFocus = null;
let observer = null;

function loadLib() {
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${PDFJS}/pdf.min.js`;
      s.onload = () => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`;
        resolve(pdfjsLib);
      };
      s.onerror = () => {
        libPromise = null;
        reject(new Error("load failed"));
      };
      document.head.append(s);
    });
  }
  return libPromise;
}

const cssWidth = () => Math.min(stage.clientWidth - 32, MAX_WIDTH) * zoom;

function layout() {
  const w = cssWidth();
  for (const p of pages) {
    p.wrap.style.width = `${w}px`;
    p.wrap.style.height = `${(p.base.height / p.base.width) * w}px`;
    discard(p);
  }
}

function discard(p) {
  if (p.task) {
    p.task.cancel();
    p.task = null;
  }
  if (p.canvas) {
    p.canvas.remove();
    p.canvas = null;
  }
}

async function render(p) {
  if (p.canvas || p.task) return;
  const mine = token;
  const page = await doc.getPage(p.number);
  if (mine !== token) return;
  const actual = page.getViewport({ scale: 1 });
  if (actual.width !== p.base.width || actual.height !== p.base.height) {
    p.base = { width: actual.width, height: actual.height };
    p.wrap.style.height = `${(p.base.height / p.base.width) * cssWidth()}px`;
  }
  const scale = cssWidth() / p.base.width;
  const viewport = page.getViewport({ scale });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  p.canvas = canvas;
  p.wrap.append(canvas);
  p.task = page.render({
    canvasContext: canvas.getContext("2d"),
    viewport,
    transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
  });
  try {
    await p.task.promise;
  } catch {
    /* cancelled by a zoom, a close, or scrolling away */
  }
  p.task = null;
}

function trackPage() {
  const mid = stage.scrollTop + stage.clientHeight / 2;
  let n = 1;
  for (const p of pages) if (p.wrap.offsetTop <= mid) n = p.number;
  countEl.textContent = `${n} / ${pages.length}`;
}

async function open(url, title) {
  lastFocus = document.activeElement;
  token++;
  const mine = token;

  titleEl.textContent = title;
  tabEl.href = url;
  dlEl.href = url;
  countEl.textContent = "";
  stage.innerHTML = "";
  pages = [];
  zoom = 1;
  statusEl.textContent = "Loading…";
  statusEl.hidden = false;
  overlay.hidden = false;
  document.body.classList.add("reader-open");
  closeEl.focus();

  let lib;
  try {
    lib = await loadLib();
  } catch {
    statusEl.textContent = "Could not load the PDF viewer. Open in a new tab instead.";
    return;
  }
  if (mine !== token) return;

  try {
    doc = await lib.getDocument(url).promise;
  } catch {
    statusEl.textContent = "Could not open this file. Try the download button.";
    return;
  }
  if (mine !== token) return;

  const v = (await doc.getPage(1)).getViewport({ scale: 1 });
  if (mine !== token) return;
  for (let n = 1; n <= doc.numPages; n++) {
    const wrap = document.createElement("div");
    wrap.className = "reader-pg";
    stage.append(wrap);
    pages.push({ number: n, wrap, base: { width: v.width, height: v.height }, canvas: null, task: null });
  }

  statusEl.hidden = true;
  layout();
  trackPage();

  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const p = pages.find((x) => x.wrap === e.target);
        if (!p) continue;
        if (e.isIntersecting) render(p);
        else discard(p);
      }
    },
    { root: stage, rootMargin: "200% 0px" },
  );
  for (const p of pages) observer.observe(p.wrap);
}

function close() {
  token++;
  observer?.disconnect();
  observer = null;
  for (const p of pages) discard(p);
  pages = [];
  doc?.destroy();
  doc = null;
  stage.innerHTML = "";
  overlay.hidden = true;
  document.body.classList.remove("reader-open");
  lastFocus?.focus();
}

function setZoom(next) {
  zoom = Math.min(3, Math.max(0.5, next));
  const anchor = pages.find((p) => p.wrap.offsetTop + p.wrap.offsetHeight > stage.scrollTop);
  layout();
  if (anchor) stage.scrollTop = anchor.wrap.offsetTop;
  if (observer) {
    for (const p of pages) {
      observer.unobserve(p.wrap);
      observer.observe(p.wrap);
    }
  }
}

document.addEventListener("click", (e) => {
  const link = e.target.closest(".item-link");
  if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  open(link.href, link.querySelector(".item-title").textContent);
});

closeEl.addEventListener("click", close);
overlay.querySelector(".reader-in").addEventListener("click", () => setZoom(zoom + 0.25));
overlay.querySelector(".reader-out").addEventListener("click", () => setZoom(zoom - 0.25));
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) close();
});
stage.addEventListener("scroll", trackPage, { passive: true });
window.addEventListener("resize", () => {
  if (!overlay.hidden && pages.length) layout();
});
document.addEventListener("keydown", (e) => {
  if (overlay.hidden) return;
  if (e.key === "Escape") close();
});
