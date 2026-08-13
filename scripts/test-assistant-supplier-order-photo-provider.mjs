import { readFile } from "node:fs/promises";
import sharp from "sharp";
import {
  extractSupplierOrderPhotoWithGemini,
  SupplierOrderPhotoProviderError,
} from "../lib/ai/supplier-order-photo-gemini.ts";

const imagePath = process.argv[2] ?? null;

if (!process.env.GEMINI_API_KEY?.trim()) {
  console.error("RESULT=configuration_error");
  process.exitCode = 2;
} else {
  const syntheticImage = () => sharp(Buffer.from(`<svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="800" fill="white"/>
    <g fill="black" font-family="Arial" font-size="54">
      <text x="80" y="110">Negociacao: 123456</text>
      <text x="80" y="200">Data Negociacao: 12/08/2026</text>
      <text x="80" y="330">Cod. 6</text>
      <text x="580" y="330">Qtde. 2</text>
    </g>
  </svg>`)).png().toBuffer();
  const bytes = imagePath ? await readFile(imagePath) : await syntheticImage();
  const mimeType = imagePath?.toLocaleLowerCase("en-US").endsWith(".png")
    ? "image/png"
    : imagePath ? "image/jpeg" : "image/png";
  const startedAt = Date.now();

  try {
    const result = await extractSupplierOrderPhotoWithGemini({ bytes, mimeType });
    const lines = result.lines.map((line) => ({
      code: line.rawCode,
      quantity: line.quantity,
      needsReview: line.needsReview,
      hasWarning: Boolean(line.warning),
    }));
    console.log(JSON.stringify({
      result: "success",
      negotiationNumber: result.negotiationNumber,
      orderDate: result.orderDate,
      lineCount: result.lines.length,
      lines,
      documentWarningCount: result.documentWarnings.length,
      durationMs: Date.now() - startedAt,
    }));
  } catch (error) {
    const providerError = error instanceof SupplierOrderPhotoProviderError ? error : null;
    console.error(JSON.stringify({
      result: "provider_error",
      internalCode: providerError?.internalCode ?? "UNEXPECTED",
      providerStatus: providerError?.providerStatus ?? null,
      model: providerError?.model ?? "unknown",
      durationMs: Date.now() - startedAt,
    }));
    process.exitCode = 1;
  }
}
