import {
  supplierOrderPhotoClientTargetBytes,
  supplierOrderPhotoMaxFileBytes,
  supplierOrderPhotoMimeTypes,
  readSupplierOrderPhotoDimensions,
  supplierOrderPhotoDimensionsAreSafe,
  validateSupplierOrderPhotoBytes,
} from "@/lib/assistant-supplier-order-photo-contract";

// Original photos within the server contract are never re-encoded. Only an
// oversized file needs decoding (including EXIF orientation) and compression.
const maximumInputBytes = 40_000_000;

export class AssistantPhotoPreparationError extends Error {}

function outputName(name: string) {
  const stem = name.replace(/\.[^.]+$/, "").slice(0, 100) || "pedido";
  return `${stem}.jpg`;
}

async function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
}

export async function prepareSupplierOrderPhoto(file: File): Promise<File> {
  const mimeType = file.type.toLowerCase();
  if (!supplierOrderPhotoMimeTypes.includes(mimeType as never)) {
    throw new AssistantPhotoPreparationError("Use uma imagem JPEG, PNG, WebP, HEIC ou HEIF.");
  }
  if (!file.size) throw new AssistantPhotoPreparationError("A imagem selecionada está vazia.");
  if (file.size > maximumInputBytes) {
    throw new AssistantPhotoPreparationError("Esta foto é muito grande. Escolha uma imagem menor.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = validateSupplierOrderPhotoBytes(mimeType, bytes);
  const dimensions = validated.ok ? readSupplierOrderPhotoDimensions(bytes, validated.mimeType) : null;
  if (!validated.ok || !supplierOrderPhotoDimensionsAreSafe(dimensions)) {
    throw new AssistantPhotoPreparationError("Não foi possível validar esta imagem. Escolha outra foto.");
  }
  if (file.size <= supplierOrderPhotoMaxFileBytes) return file;

  if (mimeType === "image/heic" || mimeType === "image/heif") {
    throw new AssistantPhotoPreparationError(
        "Esta foto HEIC/HEIF é muito grande. Converta-a para JPEG ou escolha uma foto menor.",
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new AssistantPhotoPreparationError("Não foi possível preparar esta imagem. Escolha outra foto.");
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new AssistantPhotoPreparationError("Não foi possível preparar esta imagem.");
    // Prefer full resolution and high quality; reduce dimensions only if the
    // byte budget cannot be reached. White preserves contrast for alpha input.
    for (const [scale, quality] of [[1, 0.95], [1, 0.92], [1, 0.86], [0.8, 0.92], [0.65, 0.92]] as const) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas, quality);
      if (blob && blob.size <= supplierOrderPhotoClientTargetBytes) {
        return new File([blob], outputName(file.name), {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
      }
    }
    throw new AssistantPhotoPreparationError(
      "A imagem ainda ficou muito grande. Aproxime a folha e tente outra foto.",
    );
  } finally {
    bitmap.close();
  }
}
