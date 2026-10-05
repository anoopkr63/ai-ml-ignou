// Encrypts the plaintext plan into scripts/plan-data.sealed, which is what gets
// committed. The plaintext scripts/plan-data.mjs stays gitignored on your machine.
//
//   PLAN_PASSPHRASE='…' bun run seal
//
// Re-run it after every edit to the plan, before committing.

import { writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "scripts/plan-data.mjs");
const OUT = join(ROOT, "scripts/plan-data.sealed");

const passphrase = process.env.PLAN_PASSPHRASE;
if (!passphrase) {
  console.error("PLAN_PASSPHRASE is not set. Nothing was sealed.");
  process.exit(1);
}
if (!existsSync(SRC)) {
  console.error(`${SRC} not found. Nothing was sealed.`);
  process.exit(1);
}

const PBKDF2_ITERATIONS = 600000;
const mod = await import(pathToFileURL(SRC).href);
const data = Object.fromEntries(Object.entries(mod).filter(([, v]) => typeof v !== "function"));
const plaintext = JSON.stringify(data);

const salt = webcrypto.getRandomValues(new Uint8Array(16));
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const base = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
  "deriveKey",
]);
const key = await webcrypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
  base,
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt"],
);
const ct = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

writeFileSync(
  OUT,
  JSON.stringify({ v: 1, iter: PBKDF2_ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) }) + "\n",
);

console.log(`Sealed ${Object.keys(data).length} exports (${plaintext.length} chars) into scripts/plan-data.sealed`);
