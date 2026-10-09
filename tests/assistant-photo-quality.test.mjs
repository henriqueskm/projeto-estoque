import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { captureAssistantCameraPhoto } from "../lib/assistant-camera-photo.ts";
import { prepareSupplierOrderPhoto } from "../lib/assistant-photo-upload.ts";
import { interpretSupplierOrderPhoto } from "../lib/assistant-supplier-order-photo.ts";
import { updateSupplierOrderPhotoPreviewLine } from "../lib/assistant-supplier-order-photo-preview.ts";

function image(mime = "image/png", width = 4032, height = 3024, size = 40) {
  const bytes = new Uint8Array(size);
  if (mime === "image/png") {
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    new DataView(bytes.buffer).setUint32(16, width);
    new DataView(bytes.buffer).setUint32(20, height);
  } else if (mime === "image/jpeg") {
    bytes.set([255, 216, 255, 192, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255]);
  } else if (mime === "image/webp") {
    bytes.set(new TextEncoder().encode("RIFF0000WEBPVP8X"));
    for (let i = 0; i < 3; i++) { bytes[24 + i] = (width - 1) >> (8 * i); bytes[27 + i] = (height - 1) >> (8 * i); }
  } else {
    bytes.set(new TextEncoder().encode(`ftyp${mime === "image/heic" ? "heic" : "heif"}`), 4);
    bytes.set(new TextEncoder().encode("ispe"), 16);
    new DataView(bytes.buffer).setUint32(24, width);
    new DataView(bytes.buffer).setUint32(28, height);
  }
  return new File([bytes], `fictional.${mime.split("/")[1]}`, { type: mime, lastModified: 1 });
}

test("ImageCapture preserves real photo bytes/dimensions, no second canvas capture", async () => {
  const photo = image();
  let native = 0;
  const result = await captureAssistantCameraPhoto({
    takePhoto: async () => { native++; return photo; },
    captureCanvas: () => { throw Error("Must not capture twice"); },
    signal: new AbortController().signal, isCurrent: () => true,
  });
  assert.equal(native, 1);
  assert.equal(result.blob, photo);
  assert.equal(result.source, "image-capture");
  assert.deepEqual(result.dimensions, { width: 4032, height: 3024 });
});

test("missing ImageCapture and rejected native capture automatically use canvas once", async () => {
  for (const takePhoto of [undefined, async () => { throw new DOMException("Not supported"); }]) {
    let canvas = 0;
    const result = await captureAssistantCameraPhoto({ takePhoto,
      captureCanvas: async () => { canvas++; return image("image/jpeg", 1920, 1080); },
      signal: new AbortController().signal, isCurrent: () => true,
    });
    assert.equal(canvas, 1);
    assert.equal(result.source, "canvas");
    assert.deepEqual(result.dimensions, { width: 1920, height: 1080 });
  }
});

test("native timeout falls back once and its late result is never published", async () => {
  let finish;
  let canvas = 0;
  const result = await captureAssistantCameraPhoto({
    takePhoto: () => new Promise((resolve) => { finish = resolve; }),
    captureCanvas: async () => { canvas++; return image(); },
    timeoutMs: 15, signal: new AbortController().signal, isCurrent: () => true,
  });
  finish(image("image/jpeg"));
  await Promise.resolve();
  assert.equal(result.source, "canvas");
  assert.equal(canvas, 1);
});

test("close/unmount/background/retake abort pending photo without fallback or stale preview", async () => {
  for (const reason of ["close", "unmount", "background", "retake"]) {
    let finish;
    let current = true;
    const controller = new AbortController();
    const work = captureAssistantCameraPhoto({
      takePhoto: () => new Promise((resolve) => { finish = resolve; }),
      captureCanvas: () => { throw Error(`Stale canvas: ${reason}`); },
      signal: controller.signal, isCurrent: () => current,
    });
    await Promise.resolve();
    current = false;
    controller.abort();
    assert.equal(await work, null);
    finish(image());
    await Promise.resolve();
  }
});

test("invalid MIME/empty/unsafe native photo falls back; absent canvas result fails safely", async () => {
  for (const blob of [new Blob([]), new Blob(["not an image"], { type: "image/jpeg" }), image("image/png", 12000, 12000)]) {
    const result = await captureAssistantCameraPhoto({ takePhoto: async () => blob,
      captureCanvas: async () => image(), signal: new AbortController().signal, isCurrent: () => true });
    assert.equal(result.source, "canvas");
  }
  assert.equal(await captureAssistantCameraPhoto({ captureCanvas: async () => null,
    signal: new AbortController().signal, isCurrent: () => true }), null);
});

test("canvas callback timeout is finite too", async () => {
  assert.equal(await captureAssistantCameraPhoto({ captureCanvas: () => new Promise(() => {}),
    timeoutMs: 10, signal: new AbortController().signal, isCurrent: () => true }), null);
});

test("gallery and camera JPEG/PNG/WebP/HEIC/HEIF preserve byte identity and MIME", async () => {
  for (const mime of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]) {
    const original = image(mime);
    const prepared = await prepareSupplierOrderPhoto(original);
    assert.equal(prepared, original, "No bitmap/canvas needed for a valid original");
    assert.equal(prepared.type, mime);
    assert.deepEqual(await prepared.arrayBuffer(), await original.arrayBuffer());
    assert.equal(prepared.lastModified, 1);
  }
  const nearLimit = image("image/png", 4032, 3024, 3_899_999);
  assert.equal(await prepareSupplierOrderPhoto(nearLimit), nearLimit);
});

test("preparation rejects MIME mismatch, empty files, unsafe dimensions and oversized HEIC", async () => {
  for (const file of [new File([], "empty.png", { type: "image/png" }),
    new File([image("image/jpeg")], "fake.png", { type: "image/png" }),
    image("image/png", 12000, 12000), image("image/heic", 4032, 3024, 3_900_001)]) {
    await assert.rejects(() => prepareSupplierOrderPhoto(file));
  }
});

test("oversized JPEG compresses only when necessary with EXIF orientation, full resolution first", async () => {
  const priorBitmap = globalThis.createImageBitmap;
  const priorDocument = globalThis.document;
  const draws = [];
  const qualities = [];
  let closed = 0;
  const context = { fillRect() {}, drawImage(_bitmap, _x, _y, w, h) { draws.push([w, h]); } };
  const canvas = { width: 0, height: 0, getContext: () => context,
    toBlob(callback, mime, quality) { qualities.push([mime, quality]); callback(image("image/jpeg", 3024, 4032)); } };
  globalThis.createImageBitmap = async (_file, options) => {
    assert.deepEqual(options, { imageOrientation: "from-image" });
    return { width: 3024, height: 4032, close() { closed++; } };
  };
  globalThis.document = { createElement: () => canvas };
  try {
    const original = image("image/jpeg", 4032, 3024, 3_900_001);
    const prepared = await prepareSupplierOrderPhoto(original);
    assert.notEqual(prepared, original);
    assert.equal(prepared.type, "image/jpeg");
    assert.deepEqual(draws, [[3024, 4032]]);
    assert.deepEqual(qualities, [["image/jpeg", 0.95]]);
    assert.equal(context.fillStyle, "#ffffff");
    assert.equal(closed, 1);
  } finally { globalThis.createImageBitmap = priorBitmap; globalThis.document = priorDocument; }
});

const codes = ["1", "1H", "2", "9", "10RB", "10", "6"];
const descriptions = ["SERVO MBF-015 SEM KIT", "SERVO MBF-015 DESLOCADO + KT-29", "SERVO MBF-025 SEM KIT",
  "SERVO MBF-032 SEM KIT", "SERVO MC-040 REBAIXADO", "SERVO MC-040 SEM KIT", "SERVO VF-040 SEM KIT"];
const catalog = codes.map((code, i) => ({ code, description: descriptions[i], identity: `ITEM:${code}`, codeIdentity: code }));
const extraction = { documentType: "supplier_order", negotiationNumber: "000123", orderDate: "2026-10-09",
  lines: codes.map((rawCode, i) => ({ rawCode, rawDescription: descriptions[i].replace("SEM KIT", "S/KIT").replace("REBAIXADO", "REBAIX"),
    quantity: [10, 1, 1, 5, 10, 6, 10][i], needsReview: false, warning: null })), documentWarnings: [] };
const interpret = (value, targets = catalog) => interpretSupplierOrderPhoto({ extract: async () => value,
  loadCatalog: async () => targets, findExistingOrder: async () => null });

test("seven fictional lines, including 10RB, identify exactly and total 43 without fuzzy inference", async () => {
  const result = await interpret(extraction);
  assert.equal(result.totalQuantity, 43);
  assert.equal(result.lines.length, 7);
  assert.ok(result.lines.every((line) => line.resolution === "IDENTIFIED"));
  assert.deepEqual(result.lines.map((line) => line.displayCode), codes);
});

test("unknown/ambiguous/uncertain code, different model and illegible quantity remain review-only", async () => {
  for (const overrides of [{ rawCode: "10R3", needsReview: true, warning: "Código incerto" },
    { rawCode: "UNKNOWN" }, { rawDescription: "SERVO MBF-025 SEM KIT" }, { quantity: null }]) {
    const value = structuredClone(extraction);
    Object.assign(value.lines[0], overrides);
    const result = await interpret(value);
    assert.equal(result.lines[0].resolution, "NEEDS_REVIEW");
  }
  const ambiguous = await interpret(extraction, [...catalog, { ...catalog[0], identity: "ITEM:other", codeIdentity: "other" }]);
  assert.ok(ambiguous.lines[0].blockingReasons.includes("CODE_AMBIGUOUS"));
});

test("description conflict displays actual vs official and requires explicit catalog confirmation", async () => {
  const value = structuredClone(extraction);
  value.lines[0].rawDescription = "SERVO MBF-025 SEM KIT";
  const block = await interpret(value);
  assert.ok(block.lines[0].blockingReasons.includes("DESCRIPTION_CONFLICT"));
  assert.equal(block.lines[0].rawDescription, value.lines[0].rawDescription);
  assert.equal(block.lines[0].description, descriptions[0]);
  const confirmed = updateSupplierOrderPhotoPreviewLine(block, 0, { code: "1", description: descriptions[0] });
  assert.equal(confirmed.lines[0].resolution, "IDENTIFIED");
  assert.equal(confirmed.totalQuantity, 43);
  assert.equal(confirmed.lines[0].rawDescription, value.lines[0].rawDescription);
  const source = readFileSync(new URL("../components/assistant-structured-block.tsx", import.meta.url), "utf8");
  assert.match(source, /Lido na foto:/);
  assert.match(source, /Catálogo oficial:/);
  assert.match(source, /Confirmar \/ corrigir código/);
  assert.match(source, /hasCodeBlocker \|\| hasDescriptionConflict/);
});

test("camera wiring keeps ideal-only resolution, cancellation, telemetry and capture lock", () => {
  const source = readFileSync(new URL("../components/assistant-camera-capture.tsx", import.meta.url), "utf8");
  assert.match(source, /width: \{ ideal: 3_840 \}/);
  assert.match(source, /height: \{ ideal: 2_160 \}/);
  assert.doesNotMatch(source, /exact:|\bmin:/);
  assert.match(source, /captureControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /\|\| captureControllerRef\.current\) return/);
  assert.match(source, /data-photo-width/);
  assert.match(source, /data-video-width/);
  assert.doesNotMatch(source, /fetch\(|\.rpc\(/);
});
