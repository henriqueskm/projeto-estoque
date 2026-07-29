"use client";

import { useState } from "react";
import { CommercialConfigurationImage } from "@/components/commercial-configuration-image";
import { CompatibleKitImages } from "@/components/compatible-kit-images";
import {
  parseAssistantStructuredBlock,
  type AssistantMediaDescriptor,
} from "@/lib/assistant-types";
import type { AssistantMediaReference } from "@/lib/assistant-session";

type RefreshState =
  | { status: "idle"; descriptor: null }
  | { status: "loading"; descriptor: null }
  | { status: "error"; descriptor: null; message: string }
  | { status: "ready"; descriptor: AssistantMediaDescriptor };

export function AssistantRestoredMediaControl({
  disabled,
  reference,
}: {
  disabled: boolean;
  reference: AssistantMediaReference;
}) {
  const [refreshState, setRefreshState] = useState<RefreshState>({
    status: "idle",
    descriptor: null,
  });

  async function refreshMedia() {
    if (disabled || refreshState.status === "loading") {
      return;
    }

    setRefreshState({ status: "loading", descriptor: null });

    try {
      const response = await fetch("/api/assistant/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: reference.code }),
      });
      const value: unknown = await response.json().catch(() => null);
      const record =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
      const block = parseAssistantStructuredBlock(
        record?.structuredBlock,
      );

      if (!response.ok || block?.kind !== "catalog_media") {
        throw new Error("invalid-media-response");
      }

      const candidates = block.results.filter(
        (target) => target.mediaDescriptor !== null,
      );
      const exactTarget =
        reference.targetKind && reference.targetId
          ? candidates.find(
              (target) =>
                target.targetKind === reference.targetKind &&
                target.targetId === reference.targetId,
            )
          : candidates.length === 1
            ? candidates[0]
            : null;

      if (!exactTarget?.mediaDescriptor) {
        throw new Error("media-not-found");
      }

      setRefreshState({
        status: "ready",
        descriptor: exactTarget.mediaDescriptor,
      });
    } catch {
      setRefreshState({
        status: "error",
        descriptor: null,
        message: "Não foi possível atualizar a foto agora.",
      });
    }
  }

  if (refreshState.status === "ready") {
    const descriptor = refreshState.descriptor;

    if (descriptor.kind === "commercial_configuration_image") {
      return (
        <CommercialConfigurationImage
          commercialCodes={descriptor.commercialCodes}
          imageUrl={descriptor.imageUrl}
          openOnMount
          triggerLabel={`Ver foto do código ${reference.code}`}
          triggerVariant="assistant-action"
        />
      );
    }

    return (
      <CompatibleKitImages
        kitCode={descriptor.kitCode}
        options={descriptor.options}
        openOnMount
        triggerVariant="assistant-action"
      />
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={disabled || refreshState.status === "loading"}
        onClick={() => void refreshMedia()}
        className="nk-focus inline-flex min-h-11 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 px-3 text-xs font-black text-violet-900 transition hover:border-violet-400 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {refreshState.status === "loading"
          ? "Atualizando foto..."
          : `Ver foto · Cód. ${reference.code}`}
      </button>
      {refreshState.status === "error" ? (
        <span role="status" className="text-xs font-semibold text-red-800">
          {refreshState.message}
        </span>
      ) : null}
    </span>
  );
}
