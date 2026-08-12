import {
  supplierOrderPhotoClientTargetBytes,
  supplierOrderPhotoMaxFileBytes,
  supplierOrderPhotoMimeTypes,
} from "@/lib/assistant-supplier-order-photo-contract";

const maximumDimension = 2_800;

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

  if (mimeType === "image/heic" || mimeType === "image/heif") {
    if (file.size > supplierOrderPhotoMaxFileBytes) {
      throw new AssistantPhotoPreparationError(
        "Esta foto HEIC/HEIF é muito grande. Converta-a para JPEG ou escolha uma foto menor.",
      );
    }
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new AssistantPhotoPreparationError("Não foi possível preparar esta imagem. Escolha outra foto.");
  }
  try {
    const scale = Math.min(1, maximumDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new AssistantPhotoPreparationError("Não foi possível preparar esta imagem.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.92, 0.86, 0.78]) {
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
