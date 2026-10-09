import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import sharp from "sharp";
import { rainbowHEIC } from "./fixtures/heic-rainbow.mjs";
import { prepareSupplierOrderPhotoForOpenAI, SupplierOrderPhotoConversionError } from "../lib/ai/supplier-order-photo-heic.ts";
import { extractSupplierOrderPhoto } from "../lib/ai/supplier-order-photo-media.ts";

test("real HEVC HEIC/HEIF decode in terminable worker to valid JPEG, no metadata", async () => {
  for (const mimeType of ["image/heic", "image/heif"]) {
    const out = await prepareSupplierOrderPhotoForOpenAI({ bytes: new Uint8Array(rainbowHEIC), mimeType });
    assert.equal(out.mimeType, "image/jpeg"); assert.ok(out.bytes.length < 3_500_000);
    const meta = await sharp(out.bytes).metadata();
    assert.equal(meta.width, 451); assert.equal(meta.height, 461);
    assert.equal(meta.exif, undefined); assert.equal(meta.xmp, undefined);
    // Synthetic rainbow must keep its colored pixels, not yield a blank JPEG.
    const stats = await sharp(out.bytes).stats();
    assert.ok(stats.channels.every(channel => channel.stdev > 10));
  }
});

function rotatedFixture() {
  // Fixed public fixture only: add irot=1 to ipco and essential property 6 to
  // ipma, fixing ancestor sizes and both iloc base offsets after insertion.
  const irot = Buffer.alloc(9); irot.writeUInt32BE(9); irot.write("irot", 4); irot[8] = 1;
  const b = Buffer.concat([rainbowHEIC.subarray(0, 1108), irot, rainbowHEIC.subarray(1108, 1132), Buffer.from([0x86]), rainbowHEIC.subarray(1132)]);
  for (const offset of [24, 212]) b.writeUInt32BE(b.readUInt32BE(offset) + 10, offset);
  b.writeUInt32BE(b.readUInt32BE(220) + 9, 220);
  b.writeUInt32BE(25, 1117); b[1135] = 6;
  for (const offset of [89, 107]) b.writeUInt32BE(b.readUInt32BE(offset) + 10, offset);
  return b;
}
test("real HEIF container orientation is applied before JPEG encoding (irot 90°)", async () => {
  const baseline = await prepareSupplierOrderPhotoForOpenAI({ bytes: rainbowHEIC, mimeType: "image/heic" });
  const out = await prepareSupplierOrderPhotoForOpenAI({ bytes: rotatedFixture(), mimeType: "image/heic" });
  const meta = await sharp(out.bytes).metadata();
  assert.equal(meta.width, 461); assert.equal(meta.height, 451);
  const expected = await sharp(baseline.bytes).rotate(270).resize(20, 20).raw().toBuffer();
  const actual = await sharp(out.bytes).resize(20, 20).raw().toBuffer();
  const meanError = actual.reduce((sum, value, i) => sum + Math.abs(value - expected[i]), 0) / actual.length;
  assert.ok(meanError < 10, `orientation error ${meanError}`);
});
test("valid JPEG/PNG/WebP identity preserved, never opens worker", async () => {
  for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
    const input = { bytes: new Uint8Array([1, 2, 3]), mimeType };
    assert.equal(await prepareSupplierOrderPhotoForOpenAI(input, { workerFactory: () => assert.fail("unnecessary conversion") }), input);
  }
});
test("invalid magic/dimensions/oversize are rejected before decoder", async () => {
  for (const bytes of [new Uint8Array([1, 2, 3]), new Uint8Array(3_900_001)]) {
    await assert.rejects(prepareSupplierOrderPhotoForOpenAI({ bytes, mimeType: "image/heic" }, { workerFactory: () => assert.fail("unsafe decode") }), SupplierOrderPhotoConversionError);
  }
});
test("deadline terminates worker ignoring all signals and discards late result", async () => {
  let terminated = 0;
  const worker = new EventEmitter(); worker.terminate = async () => { terminated++; };
  const started = performance.now();
  await assert.rejects(prepareSupplierOrderPhotoForOpenAI({ bytes: rainbowHEIC, mimeType: "image/heic" }, { timeoutMs: 10, workerFactory: () => worker }), SupplierOrderPhotoConversionError);
  assert.equal(terminated, 1); assert.ok(performance.now() - started < 500);
});
test("HEIC reaches vision as JPEG only, through unchanged canonical extraction", async () => {
  let calls = 0;
  const extraction = { documentType: "unknown", negotiationNumber: null, orderDate: null, lines: [], documentWarnings: [] };
  const out = await extractSupplierOrderPhoto({ bytes: rainbowHEIC, mimeType: "image/heic" }, { openai: async input => {
    calls++; assert.equal(input.mimeType, "image/jpeg"); assert.equal(input.bytes[0], 255); assert.equal(input.bytes[1], 216);
    return extraction;
  } });
  assert.equal(out, extraction); assert.equal(calls, 1);
});
