const payload = JSON.parse(document.querySelector(".payload").textContent);
const vault = document.querySelector(".vault");
const form = document.querySelector(".unlock");
const field = document.querySelector("#passphrase");
const error = document.querySelector(".unlock-error");

const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function decrypt(passphrase) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bytes(payload.salt), iterations: payload.iter, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(payload.iv) }, key, bytes(payload.ct));
  return new TextDecoder().decode(plain);
}

async function unlock(passphrase) {
  const html = await decrypt(passphrase);
  vault.innerHTML = html;
  vault.hidden = false;
  form.closest(".plan-intro").hidden = true;
  try { sessionStorage.setItem("plan-pass", passphrase); } catch {}
  start(passphrase);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.hidden = true;
  try {
    await unlock(field.value);
  } catch {
    error.hidden = false;
    field.select();
  }
});

let remembered = null;
try { remembered = sessionStorage.getItem("plan-pass"); } catch {}
if (remembered) {
  unlock(remembered).catch(() => {
    try { sessionStorage.removeItem("plan-pass"); } catch {}
  });
}

function start() {
  const KEY = "plan-progress";

  // The nav acts as tabs: one section is shown at a time.
  const tabs = [...vault.querySelectorAll(".plan-nav .tab")];
  const panels = [...vault.querySelectorAll(".panel")];
  const show = (id) => {
    const panel = panels.find((p) => p.id === id) ?? panels.find((p) => p.id === "timeline") ?? panels[0];
    for (const p of panels) p.classList.toggle("active", p === panel);
    for (const t of tabs) {
      if (t.hash === `#${panel.id}`) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    }
  };
  show(location.hash.slice(1));
  window.addEventListener("hashchange", () => {
    show(location.hash.slice(1));
    document.querySelector(".plan-nav").scrollIntoView({ block: "start" });
  });

  let done = {};
  try { done = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch {}

  const boxes = [...vault.querySelectorAll(".task input")];
  for (const box of boxes) box.checked = Boolean(done[box.id]);

  const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

  const fill = (scope, n, total) => {
    scope.querySelector(".bar-fill").style.width = `${pct(n, total)}%`;
    scope.querySelector(".bar-count").textContent = `${n} / ${total}`;
  };

  const draw = () => {
    for (const phase of vault.querySelectorAll(".phase")) {
      const inner = [...phase.querySelectorAll(".task input")];
      fill(phase.querySelector(".phase-bar"), inner.filter((b) => b.checked).length, inner.length);
      for (const day of phase.querySelectorAll(".day")) {
        const own = [...day.querySelectorAll(".task input")];
        const hit = own.filter((b) => b.checked).length;
        day.querySelector(".day-count").textContent = `${hit} / ${own.length}`;
        day.classList.toggle("day-done", hit === own.length);
      }
      for (const week of phase.querySelectorAll(".week")) {
        const own = [...week.querySelectorAll(".task input")];
        const hit = own.filter((b) => b.checked).length;
        week.querySelector(".week-count").textContent = `${hit} / ${own.length}`;
        week.classList.toggle("week-done", hit === own.length);
      }
    }
    fill(vault.querySelector(".overall"), boxes.filter((b) => b.checked).length, boxes.length);
  };

  for (const box of boxes) {
    box.addEventListener("change", () => {
      state[box.id] = { v: box.checked ? 1 : 0, t: Date.now() };
      save();
      draw();
      push();
    });
  }

  draw();

  /* Progress follows the passphrase, so the same plan opened on another device
     picks up where this one left off. Without the sync endpoint the plan still
     works, it just stays on this device. */
  const status = vault.querySelector(".sync");
  const say = (text) => { if (status) status.textContent = text; };

  let syncKey = null;
  let pushing = 0;

  const hashKey = async () => {
    const data = new TextEncoder().encode(`${passphrase}:plan-progress`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const pull = async () => {
    if (!syncKey) return;
    const res = await fetch(`/api/progress?key=${syncKey}`);
    if (!res.ok) throw new Error(res.status);
    const remote = (await res.json()).state ?? {};
    const merged = merge(state, remote);
    const changed = JSON.stringify(merged) !== JSON.stringify(state);
    state = merged;
    if (changed) {
      apply();
      save();
      draw();
    }
    say("Synced");
    return changed;
  };

  const send = async () => {
    const res = await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: syncKey, state }),
    });
    if (!res.ok) throw new Error(res.status);
    say("Synced");
  };

  const push = () => {
    if (!syncKey) return;
    clearTimeout(pushing);
    say("Saving…");
    pushing = setTimeout(() => {
      send().catch(() => say("Saved on this device"));
    }, 1200);
  };

  (async () => {
    try {
      syncKey = await hashKey();
      await pull();
      await send();
    } catch {
      syncKey = null;
      say("Saved on this device");
    }
  })();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pull().catch(() => say("Saved on this device"));
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = (iso) => Math.ceil((new Date(`${iso}T00:00:00`) - today) / 86400000);

  for (const el of vault.querySelectorAll("[data-countdown]")) {
    const left = days(el.dataset.countdown);
    el.textContent = left > 1 ? `in ${left} days` : left === 1 ? "tomorrow" : left === 0 ? "today" : "passed";
    el.classList.toggle("countdown-past", left < 0);
    el.classList.toggle("countdown-near", left >= 0 && left <= 7);
  }

  const current = [...vault.querySelectorAll(".day")].find(
    (d) => days(d.dataset.start) <= 0 && days(d.dataset.end) >= 0,
  );
  if (current) {
    current.classList.add("today");
    current.querySelector(".day-when").insertAdjacentHTML("afterend", '<span class="today-flag">Today</span>');
    const week = current.closest(".week");
    if (week) week.querySelector(".week-label").insertAdjacentHTML("afterend", '<span class="week-now">This week</span>');
    // Everything starts collapsed, so today is flagged where it sits, not opened.
  }

  // One control for the whole timeline: phases, weeks and days together.
  const groups = [...vault.querySelectorAll(".phase, .week, .day")];
  const expand = vault.querySelector(".expand");
  const syncExpand = () => {
    expand.textContent = groups.some((g) => g.open) ? "Collapse all" : "Expand all";
  };
  expand.addEventListener("click", () => {
    const open = !groups.some((g) => g.open);
    for (const g of groups) g.open = open;
    syncExpand();
  });
  vault.addEventListener("toggle", syncExpand, true);
  syncExpand();

  const reset = vault.querySelector(".reset");
  let arming = 0;
  reset.addEventListener("click", () => {
    if (!arming) {
      reset.textContent = "Click again to confirm";
      reset.classList.add("reset-armed");
      arming = setTimeout(() => {
        reset.textContent = "Reset progress";
        reset.classList.remove("reset-armed");
        arming = 0;
      }, 4000);
      return;
    }
    clearTimeout(arming);
    arming = 0;
    const now = Date.now();
    for (const id of Object.keys(state)) state[id] = { v: 0, t: now };
    save();
    for (const box of boxes) box.checked = false;
    push();
    reset.textContent = "Reset progress";
    reset.classList.remove("reset-armed");
    draw();
  });
}
