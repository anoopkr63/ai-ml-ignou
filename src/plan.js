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
  start();
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
        day.classList.toggle("day-done", own.every((b) => b.checked));
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
      if (box.checked) done[box.id] = true;
      else delete done[box.id];
      try { localStorage.setItem(KEY, JSON.stringify(done)); } catch {}
      draw();
    });
  }

  draw();

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
    if (week) {
      week.open = true;
      week.querySelector(".week-label").insertAdjacentHTML("afterend", '<span class="week-now">This week</span>');
    }
    if (!location.hash) current.scrollIntoView({ block: "center" });
  }

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
    done = {};
    try { localStorage.removeItem(KEY); } catch {}
    for (const box of boxes) box.checked = false;
    reset.textContent = "Reset progress";
    reset.classList.remove("reset-armed");
    draw();
  });
}
