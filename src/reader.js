const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
const MAX_WIDTH = 1100;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

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
let sheet = null;
let pages = [];
let pad = 32;
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

const cssWidth = () => Math.min(stage.clientWidth - pad, MAX_WIDTH) * zoom;

// Keeping the canvases lets a zoom stretch the existing bitmap, so the page
// tracks the fingers; refresh() redraws them sharp once the gesture ends.
function layout(keep) {
  const w = cssWidth();
  for (const p of pages) {
    p.wrap.style.width = `${w}px`;
    p.wrap.style.height = `${(p.base.height / p.base.width) * w}px`;
    if (!keep) discard(p);
  }
}

function refresh() {
  if (!observer) return;
  for (const p of pages) {
    discard(p);
    observer.unobserve(p.wrap);
    observer.observe(p.wrap);
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
  sheet = document.createElement("div");
  sheet.className = "reader-doc";
  stage.append(sheet);
  pad = parseFloat(getComputedStyle(sheet).paddingLeft) * 2 || 0;
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
    sheet.append(wrap);
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
  sheet = null;
  doc?.destroy();
  doc = null;
  stage.innerHTML = "";
  overlay.hidden = true;
  document.body.classList.remove("reader-open");
  lastFocus?.focus();
}

// fx/fy are the point in the stage that should stay put, defaulting to its centre.
function setZoom(next, fx, fy) {
  const was = zoom;
  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  if (zoom === was || !pages.length) return;
  const ratio = zoom / was;
  const x = fx ?? stage.clientWidth / 2;
  const y = fy ?? stage.clientHeight / 2;
  layout(true);
  stage.scrollLeft = (stage.scrollLeft + x) * ratio - x;
  stage.scrollTop = (stage.scrollTop + y) * ratio - y;
  trackPage();
}

function step(by) {
  setZoom(zoom + by);
  refresh();
}

document.addEventListener("click", (e) => {
  const link = e.target.closest(".item-link");
  if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  open(link.href, link.querySelector(".item-title").textContent);
});

closeEl.addEventListener("click", close);
overlay.querySelector(".reader-in").addEventListener("click", () => step(0.25));
overlay.querySelector(".reader-out").addEventListener("click", () => step(-0.25));
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) close();
});
stage.addEventListener("scroll", trackPage, { passive: true });

let lastWidth = 0;
window.addEventListener("resize", () => {
  if (overlay.hidden || !pages.length || stage.clientWidth === lastWidth) return;
  lastWidth = stage.clientWidth;
  layout();
  refresh();
});

document.addEventListener("keydown", (e) => {
  if (overlay.hidden) return;
  if (e.key === "Escape") close();
});

/* Touch zoom. The overlay is fixed with the body locked, so the browser's own
   pinch only blows up the chrome and leaves no way to pan — we take it over. */

let pinch = null;
let tapped = 0;

const spread = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const midpoint = (t) => {
  const r = stage.getBoundingClientRect();
  return { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top };
};

stage.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length !== 2 || !pages.length) return;
    const t = [e.touches[0], e.touches[1]];
    pinch = { gap: spread(t), from: zoom, next: zoom, frame: 0, ...midpoint(t) };
  },
  { passive: true },
);

stage.addEventListener(
  "touchmove",
  (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    pinch.next = pinch.from * (spread([e.touches[0], e.touches[1]]) / pinch.gap);
    if (pinch.frame) return;
    pinch.frame = requestAnimationFrame(() => {
      if (!pinch) return;
      pinch.frame = 0;
      setZoom(pinch.next, pinch.x, pinch.y);
    });
  },
  { passive: false },
);

function endPinch() {
  if (!pinch) return;
  if (pinch.frame) cancelAnimationFrame(pinch.frame);
  pinch = null;
  refresh();
}

stage.addEventListener(
  "touchend",
  (e) => {
    if (pinch) {
      if (e.touches.length < 2) endPinch();
      return;
    }
    if (e.touches.length || e.changedTouches.length !== 1 || !pages.length) return;
    const now = Date.now();
    if (now - tapped > 300) {
      tapped = now;
      return;
    }
    tapped = 0;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const t = e.changedTouches[0];
    setZoom(zoom > 1.01 ? 1 : 2, t.clientX - r.left, t.clientY - r.top);
    refresh();
  },
  { passive: false },
);

stage.addEventListener("touchcancel", endPinch);

// Safari ignores touch-action for zoom; these are what stop it there.
for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
  overlay.addEventListener(type, (e) => e.preventDefault());
}
