import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const skillRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

let cached;
export function loadCatalog() {
  cached ??= JSON.parse(readFileSync(join(skillRoot, "references/catalog.json"), "utf8"));
  return cached;
}

export function checkIndex(catalog = loadCatalog()) {
  const index = new Map();
  for (const room of catalog.rooms) for (const check of room.checks) index.set(check.id, { check, room });
  return index;
}
