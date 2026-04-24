import { EngineError } from "@/engine/errors";
import { parseScenario, ScenarioJsonSchema, type ScenarioJson } from "./schema";

const HASH_PREFIX_COMPRESSED = "s=";
const HASH_PREFIX_RAW = "s0=";
export const MAX_HASH_BYTES = 8 * 1024;
const MAX_DECOMPRESSED_BYTES = 512 * 1024;
const MAX_IMPORT_BYTES = 1024 * 1024;

export interface EncodedShare {
  hash: string;
  bytes: number;
  compressed: boolean;
  oversized: boolean;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary =
    typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function hasCompressionStream(): boolean {
  return (
    typeof CompressionStream !== "undefined" &&
    typeof DecompressionStream !== "undefined" &&
    typeof Response !== "undefined"
  );
}

function bytesStream(input: Uint8Array): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  }) as ReadableStream;
}

async function deflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const compressed = bytesStream(input).pipeThrough(
    new CompressionStream("deflate-raw") as unknown as ReadableWritablePair,
  );
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

async function inflateRaw(input: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const decompressed = bytesStream(input).pipeThrough(
    new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair,
  );
  const bytes = new Uint8Array(await new Response(decompressed).arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new EngineError(
      "INVALID_INPUT",
      "Shared scenario is larger than the 512 KB decoded limit.",
    );
  }
  return bytes;
}

function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Encodes the wire scenario for a URL fragment, preferring deflate-raw + falling back to plain base64url. */
export async function encodeShare(scenario: ScenarioJson): Promise<EncodedShare> {
  const validated = ScenarioJsonSchema.safeParse(scenario);
  if (!validated.success) {
    throw new EngineError("INVALID_INPUT", "Scenario is not valid; fix inputs before sharing.");
  }
  const json = JSON.stringify(validated.data);
  const rawBytes = utf8Encode(json);
  if (hasCompressionStream()) {
    const deflated = await deflateRaw(rawBytes);
    const encoded = toBase64Url(deflated);
    const hash = `${HASH_PREFIX_COMPRESSED}${encoded}`;
    return { hash, bytes: hash.length, compressed: true, oversized: hash.length > MAX_HASH_BYTES };
  }
  const encoded = toBase64Url(rawBytes);
  const hash = `${HASH_PREFIX_RAW}${encoded}`;
  return { hash, bytes: hash.length, compressed: false, oversized: hash.length > MAX_HASH_BYTES };
}

/** Accepts a URL fragment (with or without the leading '#') and returns the validated wire scenario. */
export async function decodeShare(fragment: string): Promise<ScenarioJson> {
  const trimmed = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (trimmed.length === 0) throw new EngineError("INVALID_INPUT", "The share link is empty.");
  if (trimmed.length > MAX_HASH_BYTES) {
    throw new EngineError(
      "INVALID_INPUT",
      "Share link exceeds the 8 KB fragment limit; use JSON export instead.",
    );
  }
  let payloadBytes: Uint8Array;
  if (trimmed.startsWith(HASH_PREFIX_COMPRESSED)) {
    if (!hasCompressionStream()) {
      throw new EngineError(
        "INVALID_INPUT",
        "This browser cannot decompress the share link; import the scenario JSON instead.",
      );
    }
    const deflated = fromBase64Url(trimmed.slice(HASH_PREFIX_COMPRESSED.length));
    payloadBytes = await inflateRaw(deflated, MAX_DECOMPRESSED_BYTES);
  } else if (trimmed.startsWith(HASH_PREFIX_RAW)) {
    payloadBytes = fromBase64Url(trimmed.slice(HASH_PREFIX_RAW.length));
    if (payloadBytes.byteLength > MAX_DECOMPRESSED_BYTES) {
      throw new EngineError("INVALID_INPUT", "Shared scenario exceeds the 512 KB decoded limit.");
    }
  } else {
    throw new EngineError("INVALID_INPUT", "Unrecognized share link format.");
  }
  const json = utf8Decode(payloadBytes);
  return importScenarioJsonString(json);
}

/** Exports the wire scenario as pretty-printed JSON suitable for a download or clipboard copy. */
export function exportScenarioJsonString(scenario: ScenarioJson): string {
  const validated = ScenarioJsonSchema.safeParse(scenario);
  if (!validated.success) {
    throw new EngineError("INVALID_INPUT", "Scenario is not valid; fix inputs before exporting.");
  }
  return `${JSON.stringify(validated.data, null, 2)}\n`;
}

/** Parses a JSON string into a validated wire scenario, applying the schemaVersion migration rules from §3.7. */
export function importScenarioJsonString(text: string): ScenarioJson {
  if (typeof text !== "string")
    throw new EngineError("INVALID_INPUT", "Scenario JSON must be a string.");
  if (text.length > MAX_IMPORT_BYTES) {
    throw new EngineError("INVALID_INPUT", "Scenario file exceeds the 1 MB import limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EngineError("INVALID_INPUT", "Scenario file is not valid JSON.");
  }
  parseScenario(parsed);
  const validated = ScenarioJsonSchema.safeParse(parsed);
  if (!validated.success) {
    throw new EngineError(
      "INVALID_INPUT",
      validated.error.issues
        .map((issue) => `${issue.path.join(".") || "scenario"}: ${issue.message}`)
        .join("; "),
    );
  }
  return validated.data as ScenarioJson;
}
