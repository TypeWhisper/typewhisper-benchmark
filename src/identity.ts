import { createHash } from "node:crypto";
import { JsonValueSchema, type JsonValue } from "./schema.js";

function serialize(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize(value[key]!)}`)
    .join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  return serialize(JsonValueSchema.parse(value));
}

export function contentDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
