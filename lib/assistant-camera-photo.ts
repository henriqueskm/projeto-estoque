import {
  readSupplierOrderPhotoDimensions,
  supplierOrderPhotoDimensionsAreSafe,
  validateSupplierOrderPhotoBytes,
} from "@/lib/assistant-supplier-order-photo-contract";

// takePhoto has no native AbortSignal API. Its eventual result must never be
// published or processed after timeout, fallback, hiding or closing.
async function boundedCapture<T>(
  work: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, timeoutMs: number,
): Promise<T> {
  signal.throwIfAborted();
  const attempt = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => { attempt.signal.throwIfAborted(); return work(attempt.signal); }),
      new Promise<never>((_, reject) => {
        abort = () => { attempt.abort(); reject(new DOMException("Capture cancelled", "AbortError")); };
        signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => { attempt.abort(); reject(new Error("Capture deadline")); }, timeoutMs);
      }),
    ]);
  } finally {
    attempt.abort();
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

export async function captureAssistantCameraPhoto(input: {
  takePhoto?: () => Promise<Blob>;
  captureCanvas: () => Promise<Blob | null>;
  signal: AbortSignal;
  isCurrent: () => boolean;
  timeoutMs?: number;
}) {
  for (const source of ["image-capture", "canvas"] as const) {
    if (input.signal.aborted || !input.isCurrent()) return null;
    if (source === "image-capture" && !input.takePhoto) continue;
    try {
      const result = await boundedCapture(async (signal) => {
        const blob = source === "image-capture"
          ? await input.takePhoto!() : await input.captureCanvas();
        signal.throwIfAborted();
        if (!blob?.size || blob.size > 40_000_000) throw new Error("Invalid capture size");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        signal.throwIfAborted();
        const validated = validateSupplierOrderPhotoBytes(blob.type, bytes);
        if (!validated.ok) throw new Error("Invalid capture type");
        const dimensions = readSupplierOrderPhotoDimensions(bytes, validated.mimeType);
        if (!supplierOrderPhotoDimensionsAreSafe(dimensions)) throw new Error("Invalid dimensions");
        return { blob, source, dimensions: dimensions! };
      }, input.signal, input.timeoutMs ?? 5_000);
      return input.signal.aborted || !input.isCurrent() ? null : result;
    } catch {
      // Rejected/unsupported native photos silently use the live frame instead.
      // Cancellation never starts another capture.
      if (input.signal.aborted || !input.isCurrent()) return null;
    }
  }
  return null;
}
