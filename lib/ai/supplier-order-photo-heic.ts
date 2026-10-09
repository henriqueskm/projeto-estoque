import "server-only";
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { supplierOrderPhotoMaxFileBytes, supplierOrderPhotoClientTargetBytes, readSupplierOrderPhotoDimensions, validateSupplierOrderPhotoBytes, type SupplierOrderPhotoMimeType } from "@/lib/assistant-supplier-order-photo-contract";

export const heicConversionTimeoutMs = 8_000;
// HEIC-only caps: accept ordinary 4032×3024 photos without decoding 48/60 MP.
// 16 MP is <=64 MB RGBA, NOT a bound on native/WASM/RSS memory.
export const heicConversionMaxPixels = 16_000_000;
export const heicConversionMaxDimension = 6_000;
let heicConversionActive = false;

function safeHeicDimensions(size: { width: number; height: number } | null) {
  return size !== null && Number.isSafeInteger(size.width) && Number.isSafeInteger(size.height)
    && size.width > 0 && size.height > 0 && size.width <= heicConversionMaxDimension
    && size.height <= heicConversionMaxDimension && size.width * size.height <= heicConversionMaxPixels;
}
export class SupplierOrderPhotoConversionError extends Error {
  readonly reason: "UNSAFE_IMAGE" | "BUSY";
  constructor(reason: "UNSAFE_IMAGE" | "BUSY" = "UNSAFE_IMAGE") {
    super(reason === "BUSY"
      ? "Outra foto está sendo preparada. Tente novamente em alguns instantes."
      : "Não foi possível converter esta foto HEIC/HEIF com segurança. Escolha uma imagem JPEG, PNG ou WebP.");
    this.reason = reason;
  }
}

// Fixed trusted source, never user code. libheif decodes synchronously; a worker
// allows a real deadline/termination instead of an ineffective Promise timeout.
const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const decode = require(workerData.decoderPath);
  const sharp = require(workerData.sharpPath);
  const images = await decode.all({ buffer: Buffer.from(workerData.bytes) });
  try {
    // Multi-image/sequence selection is ambiguous for a document. Fail closed.
    if (images.length !== 1) throw Error('Ambiguous image');
    const image = images[0];
    if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
      || image.width < 1 || image.height < 1 || image.width > workerData.maxDimension || image.height > workerData.maxDimension
      || image.width * image.height > workerData.maxPixels) throw Error('Unsafe dimensions');
    // libheif applies container irot/imir transforms during display/decode.
    const decoded = await image.decode();
    if (decoded.width !== image.width || decoded.height !== image.height
      || decoded.data.length !== decoded.width * decoded.height * 4) throw Error('Invalid pixels');
    for (const [scale, quality] of [[1,95], [1,92], [1,86], [.8,92], [.65,92]]) {
      const output = await sharp(Buffer.from(decoded.data), { raw: { width: decoded.width, height: decoded.height, channels: 4 } })
        .resize({ width: Math.max(1, Math.round(decoded.width * scale)), height: Math.max(1, Math.round(decoded.height * scale)) })
        .flatten({ background: '#ffffff' }).jpeg({ quality }).toBuffer();
      if (output.length <= workerData.targetBytes) {
        parentPort.postMessage({ bytes: new Uint8Array(output) }); return;
      }
    }
    throw Error('Output too large');
  } finally { images.dispose(); }
})().catch(() => parentPort.postMessage({ failed: true }));
`;

export async function prepareSupplierOrderPhotoForOpenAI(input: {
  bytes: Uint8Array; mimeType: SupplierOrderPhotoMimeType;
}, dependencies: { timeoutMs?: number; workerFactory?: (source: string, options: ConstructorParameters<typeof Worker>[1]) => Worker } = {}) {
  if (input.mimeType !== "image/heic" && input.mimeType !== "image/heif") return input;
  const validation = validateSupplierOrderPhotoBytes(input.mimeType, input.bytes);
  if (!validation.ok || input.bytes.length > supplierOrderPhotoMaxFileBytes
    || !safeHeicDimensions(readSupplierOrderPhotoDimensions(input.bytes, input.mimeType))) {
    throw new SupplierOrderPhotoConversionError();
  }
  // Fail fast, no queue and no second decoder in this instance. JPEG/PNG/WebP
  // return above even while busy. This is not a global/distributed limit.
  if (heicConversionActive) throw new SupplierOrderPhotoConversionError("BUSY");
  heicConversionActive = true;
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const nodeRequire = createRequire(import.meta.url);
    worker = (dependencies.workerFactory ?? ((source, options) => new Worker(source, options)))(workerSource, {
      eval: true,
      workerData: {
        bytes: input.bytes, decoderPath: nodeRequire.resolve("heic-decode"), sharpPath: nodeRequire.resolve("sharp"),
        targetBytes: supplierOrderPhotoClientTargetBytes, maxPixels: heicConversionMaxPixels, maxDimension: heicConversionMaxDimension,
      },
      // Only V8 heap; does not cap native/external/WASM memory.
      resourceLimits: { maxOldGenerationSizeMb: 128 }, stdout: true, stderr: true,
    });
    // Drain/discard decoder diagnostics: never log private media/provider text.
    worker.stdout?.resume(); worker.stderr?.resume();
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const fail = () => reject(new SupplierOrderPhotoConversionError());
      timer = setTimeout(fail, Math.min(dependencies.timeoutMs ?? heicConversionTimeoutMs, heicConversionTimeoutMs));
      worker!.once("message", result => {
        if (!(result?.bytes instanceof Uint8Array)) return fail();
        const valid = validateSupplierOrderPhotoBytes("image/jpeg", result.bytes);
        if (!valid.ok || result.bytes.length > supplierOrderPhotoClientTargetBytes
          || !safeHeicDimensions(readSupplierOrderPhotoDimensions(result.bytes, "image/jpeg"))) return fail();
        resolve(result.bytes);
      });
      worker!.once("error", fail); worker!.once("exit", fail);
    });
    return { bytes, mimeType: "image/jpeg" as const };
  } catch {
    throw new SupplierOrderPhotoConversionError();
  } finally {
    clearTimeout(timer);
    try { await worker?.terminate(); }
    catch {
      // Unconfirmed termination: fail closed and keep the instance gate busy.
      throw new SupplierOrderPhotoConversionError();
    }
    heicConversionActive = false;
  }
}
