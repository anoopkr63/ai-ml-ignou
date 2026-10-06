// Plan progress, shared between devices. The key is a hash of the plan
// passphrase, computed in the browser, so no account and no login are needed and
// the passphrase itself never leaves the device.

// Vercel's Upstash integration sets KV_REST_API_*; a database added directly on
// Upstash sets UPSTASH_REDIS_REST_*. Either is fine.
const URL_BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const MAX_BYTES = 64 * 1024;
const TTL_DAYS = 400;

const isKey = (k) => typeof k === "string" && /^[a-f0-9]{64}$/.test(k);

async function redis(command) {
  const res = await fetch(URL_BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  return (await res.json()).result;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!URL_BASE || !TOKEN) {
    return res.status(503).json({ error: "sync is not configured" });
  }

  try {
    if (req.method === "GET") {
      const key = req.query.key;
      if (!isKey(key)) return res.status(400).json({ error: "bad key" });
      const stored = await redis(["GET", `plan:${key}`]);
      return res.status(200).json(stored ? JSON.parse(stored) : { state: {} });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { key, state } = body ?? {};
      if (!isKey(key)) return res.status(400).json({ error: "bad key" });
      if (!state || typeof state !== "object") return res.status(400).json({ error: "bad state" });
      const payload = JSON.stringify({ state, saved: Date.now() });
      if (payload.length > MAX_BYTES) return res.status(413).json({ error: "too large" });
      await redis(["SET", `plan:${key}`, payload, "EX", String(TTL_DAYS * 86400)]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  } catch {
    return res.status(502).json({ error: "store unavailable" });
  }
}
