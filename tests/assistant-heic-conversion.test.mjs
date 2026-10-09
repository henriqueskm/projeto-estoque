import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { Worker } from "node:worker_threads";
import decode from "heic-decode";
import sharp from "sharp";
import { rainbowHEIC } from "./fixtures/heic-rainbow.mjs";
import { prepareSupplierOrderPhotoForOpenAI, SupplierOrderPhotoConversionError, heicConversionMaxPixels, heicConversionMaxDimension, heicConversionTimeoutMs } from "../lib/ai/supplier-order-photo-heic.ts";
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

function dimensionsFixture(width, height) {
  const bytes = Buffer.from(rainbowHEIC);
  const ispe = bytes.indexOf("ispe");
  bytes.writeUInt32BE(width, ispe + 8); bytes.writeUInt32BE(height, ispe + 12);
  return bytes;
}
test("HEIC-specific 16 MP/6000 px caps reject 60 MP, zero and oversized input before worker", async () => {
  assert.equal(heicConversionMaxPixels, 16_000_000); assert.equal(heicConversionMaxDimension, 6_000);
  for (const bytes of [dimensionsFixture(10_000, 6_000), dimensionsFixture(4_001, 4_000),
    dimensionsFixture(6_001, 1), dimensionsFixture(0, 461),
    Buffer.concat([rainbowHEIC, Buffer.alloc(3_900_001 - rainbowHEIC.length)])]) {
    await assert.rejects(prepareSupplierOrderPhotoForOpenAI({ bytes, mimeType: "image/heic" }, {
      workerFactory: () => assert.fail("unsafe header reached decoder"),
    }), SupplierOrderPhotoConversionError);
  }
  // Ordinary 12 MP header passes admission; this is not a full-size decode benchmark.
  let admitted = 0;
  await assert.rejects(prepareSupplierOrderPhotoForOpenAI({ bytes: dimensionsFixture(4032, 3024), mimeType: "image/heic" }, {
    workerFactory: () => { admitted++; throw Error("synthetic spawn failure"); },
  }), SupplierOrderPhotoConversionError);
  assert.equal(admitted, 1);
  // Failure to spawn releases the slot; the real fixture can run afterwards.
  assert.equal((await prepareSupplierOrderPhotoForOpenAI({ bytes: rainbowHEIC, mimeType: "image/heic" })).mimeType, "image/jpeg");
});

function ambiguousFixture() {
  // Public fixture only: turn metadata item 2 into a visible second image using
  // the SAME HEVC extent/properties. No large binary or private image is needed.
  const association = Buffer.from([0, 2, 5, 0x81, 2, 3, 5, 0x84]);
  const b = Buffer.concat([rainbowHEIC.subarray(0, 1132), association, rainbowHEIC.subarray(1132)]);
  b[167] = 0; b.write("hvc1", 172); // infe item 2: visible image, not hidden mime metadata
  for (const offset of [24, 212, 1108]) b.writeUInt32BE(b.readUInt32BE(offset) + 8, offset);
  b.writeUInt32BE(2, 1120); // ipma entry count
  b.writeUInt32BE(b.readUInt32BE(89) + 8, 89);
  b.writeUInt32BE(b.readUInt32BE(89), 107); b.writeUInt32BE(b.readUInt32BE(99), 117);
  return b;
}
test("real ambiguous multi-image HEIC fails closed, no provider, worker is cleaned", async () => {
  const bytes = ambiguousFixture();
  const images = await decode.all({ buffer: bytes });
  try { assert.equal(images.length, 2, "must prove ambiguity with real decoder"); }
  finally { images.dispose(); }
  await assert.rejects(extractSupplierOrderPhoto({ bytes, mimeType: "image/heic" }, {
    openai: async () => assert.fail("ambiguous document reached provider"),
  }), SupplierOrderPhotoConversionError);
  assert.equal((await prepareSupplierOrderPhotoForOpenAI({ bytes: rainbowHEIC, mimeType: "image/heif" })).mimeType, "image/jpeg");
});

test("corrupted real HEVC and malicious truncated container fail decode with cleanup", async () => {
  const corrupted = Buffer.from(rainbowHEIC); corrupted.fill(0, 1166, 3540);
  for (const bytes of [corrupted, rainbowHEIC.subarray(0, 1166)]) {
    await assert.rejects(extractSupplierOrderPhoto({ bytes, mimeType: "image/heic" }, {
      openai: async () => assert.fail("invalid decode reached provider"),
    }), SupplierOrderPhotoConversionError);
  }
  assert.equal((await prepareSupplierOrderPhotoForOpenAI({ bytes: rainbowHEIC, mimeType: "image/heic" })).mimeType, "image/jpeg");
});

test("3 real concurrent conversions start exactly one worker; no queue; slot reusable after exit", async () => {
  let spawned = 0; let exited = 0;
  const factory = (source, options) => {
    spawned++; const worker = new Worker(source, options); worker.once("exit", () => { exited++; }); return worker;
  };
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => prepareSupplierOrderPhotoForOpenAI({
    bytes: rainbowHEIC, mimeType: "image/heic",
  }, { workerFactory: factory })));
  assert.equal(spawned, 1); assert.equal(exited, 1);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const failures = results.filter(result => result.status === "rejected");
  assert.equal(failures.length, 2); assert.ok(failures.every(result => result.reason.reason === "BUSY"));
  await prepareSupplierOrderPhotoForOpenAI({ bytes: rainbowHEIC, mimeType: "image/heic" }, { workerFactory: factory });
  assert.equal(spawned, 2); assert.equal(exited, 2);
});

test("8 s default deadline terminates a real hung worker and releases the instance gate", async () => {
  assert.equal(heicConversionTimeoutMs, 8_000);
  let exited = false;
  const started = performance.now();
  const conversion = prepareSupplierOrderPhotoForOpenAI({ bytes: rainbowHEIC, mimeType: "image/heic" }, {
    workerFactory: () => {
      const worker = new Worker("setInterval(() => {}, 1000)", { eval: true });
      worker.once("exit", () => { exited = true; }); return worker;
    },
  });
  // JPEG/PNG/WebP still pass through while HEIC is held, with unchanged bytes.
  for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
    const input = { bytes: new Uint8Array([1, 2, 3]), mimeType };
    assert.equal(await prepareSupplierOrderPhotoForOpenAI(input), input);
  }
  await assert.rejects(conversion, SupplierOrderPhotoConversionError);
  assert.equal(exited, true); assert.ok(performance.now() - started >= 7_900);
  assert.ok(performance.now() - started < 10_000);
  assert.equal((await prepareSupplierOrderPhotoForOpenAI({ bytes: rainbowHEIC, mimeType: "image/heic" })).mimeType, "image/jpeg");
});

test("worker error/early exit/invalid JPEG or unsafe output always terminate exactly once", async () => {
  const jpeg = (width, height) => {
    const bytes = Buffer.from([255,216,255,192,0,17,8,0,0,0,0,0,0,0,0,0,0,0,0,255,217]);
    bytes.writeUInt16BE(height, 7); bytes.writeUInt16BE(width, 9); return bytes;
  };
  for (const [event, value] of [["error", Error("private decoder diagnostic")], ["exit", 1],
    ["message", { failed: true }], ["message", { bytes: new Uint8Array([1,2,3]) }],
    ["message", { bytes: jpeg(4001, 4000) }],
    ["message", { bytes: Buffer.concat([jpeg(451, 461), Buffer.alloc(3_500_001)]) }]]) {
    let terminated = 0;
    await assert.rejects(prepareSupplierOrderPhotoForOpenAI({ bytes: rainbowHEIC, mimeType: "image/heic" }, {
      workerFactory: () => {
        const worker = new EventEmitter(); worker.terminate = async () => { terminated++; };
        setImmediate(() => worker.emit(event, value)); return worker;
      },
    }), error => error instanceof SupplierOrderPhotoConversionError && !error.message.includes("private"));
    assert.equal(terminated, 1);
  }
});

// Last test deliberately leaves the instance fail-closed after unconfirmed
// termination. Other test files run in separate Node processes.
test("unconfirmed worker termination keeps the instance closed, never starts another decoder", async () => {
  let spawned = 0;
  await assert.rejects(prepareSupplierOrderPhotoForOpenAI({ bytes: rainbowHEIC, mimeType: "image/heic" }, {
    timeoutMs: 10,
    workerFactory: () => {
      spawned++; const worker = new EventEmitter();
      worker.terminate = async () => { throw Error("private termination diagnostic"); }; return worker;
    },
  }), error => error instanceof SupplierOrderPhotoConversionError && !error.message.includes("private"));
  await assert.rejects(prepareSupplierOrderPhotoForOpenAI({ bytes: rainbowHEIC, mimeType: "image/heic" }, {
    workerFactory: () => { spawned++; assert.fail("unconfirmed termination admitted another worker"); },
  }), error => error.reason === "BUSY");
  assert.equal(spawned, 1);
});
