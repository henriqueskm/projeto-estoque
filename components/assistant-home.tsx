"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useAssistantConversation } from "@/components/assistant-conversation-provider";
import {
  CameraIcon,
  CloseIcon,
  ImageIcon,
  PlusIcon,
  SendIcon,
} from "@/components/icons";
import { AssistantMessageContent } from "@/components/assistant-message-content";
import { AssistantNewConversationDialog } from "@/components/assistant-new-conversation-dialog";
import { AssistantRestoredMediaControl } from "@/components/assistant-restored-media-control";
import { AssistantStructuredBlockView } from "@/components/assistant-structured-block";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { SafisaPickupAlertHomeSummary } from "@/components/safisa-pickup-alerts";
import { useAuthenticatedProfile } from "@/components/authenticated-profile-provider";
import {
  AssistantPhotoPreparationError,
  prepareSupplierOrderPhoto,
} from "@/lib/assistant-photo-upload";
import {
  assistantMessageMaxLength,
  parseAssistantStructuredBlock,
  type AssistantChatRequest,
  type AssistantChatError,
  type AssistantChatSuccess,
  type AssistantClarificationBlock,
  type AssistantSupplierOrderPickupPreviewBlock,
  type AssistantSupplierOrderPickupConfirmationResult,
  type AssistantSupplierOrderPickupResultBlock,
  type AssistantSupplierOrderStockEntryPreviewBlock,
  type AssistantSupplierOrderStockEntryResultBlock,
  type AssistantManualStockEntryPreviewBlock,
  type AssistantManualStockEntryResultBlock,
  type AssistantServoModelInventoryAction,
  type AssistantStockEntrySelection,
  type AssistantManualStockOutputPreviewBlock,
  type AssistantManualStockOutputResultBlock,
  type AssistantStockOutputSelection,
  type AssistantConfigurationAssemblySelection,
  type AssistantConfigurationAssemblyPreviewBlock,
  type AssistantConfigurationAssemblyResultBlock,
  type AssistantConfigurationDisassemblySelection,
  type AssistantConfigurationDisassemblyPreviewBlock,
  type AssistantConfigurationDisassemblyResultBlock,
  type AssistantSupplierOrderFinalizationPreviewBlock,
  type AssistantSupplierOrderFinalizationResultBlock,
} from "@/lib/assistant-types";
import {
  buildAssistantRecentConversation,
  parseAssistantConversationContext,
  parseAssistantConversationalText,
} from "@/lib/assistant-conversation";
import type { StockSummary } from "@/lib/home-data";

type AssistantHomeProps = {
  summary: StockSummary | null;
  stockError: string | null;
};

type LocalAttachment = {
  file: File;
  previewUrl: string;
  source: "camera" | "gallery";
  status: "preparing" | "ready";
};

type SupplierOrderPickupProgressStage =
  | "validating"
  | "registering"
  | "refreshing";

const supplierOrderPickupProgressLabels: Record<
  SupplierOrderPickupProgressStage,
  string
> = {
  validating: "Validando retirada...",
  registering: "Registrando retirada...",
  refreshing: "Atualizando Pedido...",
};

const initialSuggestions: AssistantClarificationBlock = {
  kind: "assistant_clarification",
  title: "Como posso ajudar?",
  message:
    "Consulte dados, prepare uma operação ou envie uma foto de Pedido. Toda alteração exige revisão e confirmação.",
  options: [
    {
      id: "initial-inventory-overview",
      label: "Consultar Estoque",
      prompt: "Como está o Estoque?",
      category: "inventory",
    },
    {
      id: "initial-stock-entry",
      label: "Preparar entrada",
      prompt: "Dê entrada manual.",
      category: "inventory",
    },
    {
      id: "initial-stock-output",
      label: "Preparar saída",
      prompt: "Dê saída manual.",
      category: "inventory",
    },
    {
      id: "initial-order-active",
      label: "Ver Pedidos",
      prompt: "Mostre meus Pedidos em andamento.",
      category: "supplier_orders",
    },
    {
      id: "initial-order-pickup",
      label: "Preparar retirada",
      prompt: "Quais Pedidos ainda têm itens para retirar?",
      category: "supplier_orders",
    },
    {
      id: "initial-order-photo",
      label: "Analisar foto de Pedido",
      prompt: "Quero analisar uma foto de Pedido.",
      category: "media",
    },
    {
      id: "initial-replenishment",
      label: "Ver o que comprar",
      prompt: "O que preciso comprar?",
      category: "replenishment",
    },
  ],
  fallbackText:
    "Posso consultar Estoque e Pedidos, preparar operações e analisar fotos de Pedido.",
};

const quantityFormatter = new Intl.NumberFormat("pt-BR");

function isStructuredAssistantMessage(content: string) {
  return /(^|\n)\s*(?:[-*+]\s+|\d+[.)]\s+)/m.test(content);
}

export function AssistantHome({
  summary,
  stockError,
}: AssistantHomeProps) {
  const router = useRouter();
  const profile = useAuthenticatedProfile();
  const {
    isHydrated,
    conversationId,
    messages,
    setMessages,
    draft,
    setDraft,
    conversationContext,
    setConversationContext,
    scrollTop,
    setScrollTop,
    persistNow,
    resetConversation,
  } = useAssistantConversation();
  const [attachment, setAttachment] = useState<LocalAttachment | null>(null);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [isNewConversationDialogOpen, setIsNewConversationDialogOpen] =
    useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false);
  const [isRefreshingStock, startStockRefresh] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const restoredConversationRef = useRef<string | null>(null);
  const previousMessageCountRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const latestScrollTopRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const actionInFlightRef = useRef(false);
  const [confirmingPickupMessageId, setConfirmingPickupMessageId] =
    useState<string | null>(null);
  const [confirmingPickupStage, setConfirmingPickupStage] =
    useState<SupplierOrderPickupProgressStage | null>(null);
  const [confirmingStockEntryMessageId, setConfirmingStockEntryMessageId] =
    useState<string | null>(null);
  const [confirmingStockOutputMessageId, setConfirmingStockOutputMessageId] =
    useState<string | null>(null);
  const [confirmingConfigurationAssemblyMessageId, setConfirmingConfigurationAssemblyMessageId] =
    useState<string | null>(null);
  const [confirmingConfigurationDisassemblyMessageId, setConfirmingConfigurationDisassemblyMessageId] =
    useState<string | null>(null);
  const [confirmingSupplierOrderFinalizationMessageId, setConfirmingSupplierOrderFinalizationMessageId] =
    useState<string | null>(null);
  const shouldRestoreFocusRef = useRef(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const newConversationButtonRef = useRef<HTMLButtonElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const attachmentMenuFirstItemRef = useRef<HTMLButtonElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuId = useId();
  const firstName = profile.hasRegisteredName
    ? (profile.displayName.split(/\s+/).filter(Boolean)[0] ?? null)
    : null;
  const isInteractionLocked = isPending || isRefreshingStock;
  const isComposerLocked = !isHydrated || isInteractionLocked;
  const hasOperationalConfirmation = Boolean(
    confirmingPickupMessageId ||
      confirmingStockEntryMessageId ||
      confirmingStockOutputMessageId ||
      confirmingConfigurationAssemblyMessageId ||
      confirmingConfigurationDisassemblyMessageId ||
      confirmingSupplierOrderFinalizationMessageId,
  );
  const canSubmit =
    !isComposerLocked &&
    Boolean(
      attachment ? attachment.status === "ready" : draft.trim(),
    );
  const stockItems = [
    ["Servos com kit", summary?.completeBoxesTotal],
    ["Servos", summary?.looseServoTotal],
    ["Kits", summary?.looseKitTotal],
    ["Reparos", summary?.repairKitTotal],
    ["Peças", summary?.loosePartTotal],
  ] as const;

  useEffect(() => {
    return () => {
      if (attachment) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, [attachment]);

  useEffect(() => {
    const conversation = conversationRef.current;
    const composer = composerRef.current;
    if (!conversation || !composer || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateComposerHeight = () => {
      conversation.style.setProperty(
        "--assistant-composer-height",
        `${Math.ceil(composer.getBoundingClientRect().height)}px`,
      );
    };
    const observer = new ResizeObserver(updateComposerHeight);
    updateComposerHeight();
    observer.observe(composer);

    return () => {
      observer.disconnect();
      conversation.style.removeProperty("--assistant-composer-height");
    };
  }, []);

  useEffect(() => {
    if (!isAttachmentMenuOpen) {
      return;
    }

    window.requestAnimationFrame(() =>
      attachmentMenuFirstItemRef.current?.focus(),
    );

    function closeMenu(restoreFocus = false) {
      setIsAttachmentMenuOpen(false);

      if (restoreFocus) {
        window.requestAnimationFrame(() => menuButtonRef.current?.focus());
      }
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !attachmentMenuRef.current?.contains(event.target) &&
        !menuButtonRef.current?.contains(event.target)
      ) {
        closeMenu();
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAttachmentMenuOpen]);

  useEffect(() => {
    const conversation = conversationRef.current;

    if (!conversation || !isHydrated || !conversationId) {
      return;
    }

    if (restoredConversationRef.current !== conversationId) {
      restoredConversationRef.current = conversationId;
      previousMessageCountRef.current = messages.length;
      latestScrollTopRef.current = scrollTop;
      window.requestAnimationFrame(() => {
        conversation.scrollTo({
          top: scrollTop,
          behavior: "auto",
        });
      });
      return;
    }

    const hasNewMessage =
      messages.length > previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;

    if (!hasNewMessage && !isInteractionLocked) {
      return;
    }

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    conversation.scrollTo({
      top: conversation.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [
    conversationId,
    isHydrated,
    isInteractionLocked,
    messages.length,
    scrollTop,
  ]);

  useEffect(() => {
    const conversation = conversationRef.current;

    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }

      persistNow({
        scrollTop:
          conversation?.scrollTop ?? latestScrollTopRef.current,
      });
    };
  }, [persistNow]);

  useEffect(() => {
    if (isInteractionLocked || !shouldRestoreFocusRef.current) {
      return;
    }

    shouldRestoreFocusRef.current = false;
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [isInteractionLocked]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    window.requestAnimationFrame(resizeTextarea);
  }, [draft, isHydrated]);

  function resizeTextarea() {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }

  function handleConversationScroll() {
    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const nextScrollTop = conversationRef.current?.scrollTop ?? 0;
      latestScrollTopRef.current = nextScrollTop;
      setScrollTop(nextScrollTop);
    });
  }

  async function handleImageSelection(
    event: ChangeEvent<HTMLInputElement>,
    source: LocalAttachment["source"],
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const initialPreviewUrl = URL.createObjectURL(file);
    setAttachment({ file, previewUrl: initialPreviewUrl, source, status: "preparing" });
    setFeedback("Preparando imagem...");

    try {
      const prepared = await prepareSupplierOrderPhoto(file);
      setAttachment((current) => {
        if (!current || current.previewUrl !== initialPreviewUrl) return current;
        return {
          file: prepared,
          previewUrl: URL.createObjectURL(prepared),
          source,
          status: "ready",
        };
      });
      setFeedback("Imagem pronta para análise.");
    } catch (error) {
      setAttachment((current) =>
        current?.previewUrl === initialPreviewUrl ? null : current,
      );
      setFeedback(
        error instanceof AssistantPhotoPreparationError
          ? error.message
          : "Não foi possível preparar esta imagem.",
      );
    } finally {
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  function removeAttachment() {
    setAttachment(null);
    setFeedback("Imagem removida.");
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function sendAssistantMessage(
    submittedMessage: string,
    context?: {
      supplierOrderId?: string;
      supplierOrderItemId?: string;
      inventoryAction?: AssistantServoModelInventoryAction;
      stockEntrySelection?: AssistantStockEntrySelection;
      stockOutputSelection?: AssistantStockOutputSelection;
      configurationAssemblySelection?: AssistantConfigurationAssemblySelection;
      configurationDisassemblySelection?: AssistantConfigurationDisassemblySelection;
    },
  ) {
    if (
      isInteractionLocked ||
      requestInFlightRef.current ||
      !submittedMessage ||
      submittedMessage.length > assistantMessageMaxLength
    ) {
      return;
    }

    requestInFlightRef.current = true;
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: submittedMessage,
      },
    ]);
    setDraft("");
    setFeedback(
      attachment
        ? "A imagem continua somente neste dispositivo. Apenas o texto foi enviado."
        : null,
    );
    setIsPending(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      const requestConversationContext = context?.supplierOrderId
        ? {
            ...conversationContext,
            topic: "SUPPLIER_ORDER" as const,
            itemQuery: null,
            itemReferenceKind: null,
            supplierOrderId: context.supplierOrderId,
          }
        : conversationContext;
      const requestBody: AssistantChatRequest = {
        message: submittedMessage,
        recentConversation: buildAssistantRecentConversation(messages),
        conversationContext: requestConversationContext,
        ...(context?.supplierOrderItemId
          ? {
              selectedSupplierOrderItemId:
                context.supplierOrderItemId,
            }
          : {}),
        ...(context?.inventoryAction
          ? { inventoryAction: context.inventoryAction }
          : {}),
        ...(context?.stockEntrySelection
          ? { stockEntrySelection: context.stockEntrySelection }
          : {}),
        ...(context?.stockOutputSelection
          ? { stockOutputSelection: context.stockOutputSelection }
          : {}),
        ...(context?.configurationAssemblySelection
          ? { configurationAssemblySelection: context.configurationAssemblySelection }
          : {}),
        ...(context?.configurationDisassemblySelection
          ? { configurationDisassemblySelection: context.configurationDisassemblySelection }
          : {}),
      };
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const result: unknown = await response.json().catch(() => null);
      const responseBody =
        result && typeof result === "object" && !Array.isArray(result)
          ? (result as Partial<AssistantChatSuccess & AssistantChatError>)
          : null;
      const responseMessage = response.ok
        ? responseBody?.message
        : responseBody?.error;
      const structuredBlock = response.ok
        ? parseAssistantStructuredBlock(responseBody?.structuredBlock)
        : null;
      const leadText = response.ok
        ? parseAssistantConversationalText(responseBody?.leadText)
        : null;
      const followUpText = response.ok
        ? parseAssistantConversationalText(responseBody?.followUpText)
        : null;
      const nextConversationContext = response.ok
        ? parseAssistantConversationContext(
            responseBody?.conversationContext,
          )
        : null;

      if (nextConversationContext) {
        setConversationContext(nextConversationContext);
      }

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            typeof responseMessage === "string" && responseMessage.trim()
              ? responseMessage.trim()
              : "Não foi possível concluir a consulta agora. Tente novamente.",
          ...(structuredBlock ? { structuredBlock } : {}),
          ...(leadText ? { leadText } : {}),
          ...(followUpText ? { followUpText } : {}),
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "Não foi possível conectar à Assistente NK. Verifique sua conexão e tente novamente.",
        },
      ]);
    } finally {
      requestInFlightRef.current = false;
      shouldRestoreFocusRef.current = true;
      setIsPending(false);
      startStockRefresh(() => {
        router.refresh();
      });
    }
  }

  async function sendSupplierOrderPhoto() {
    if (
      isInteractionLocked ||
      requestInFlightRef.current ||
      !attachment ||
      attachment.status !== "ready"
    ) {
      return;
    }

    requestInFlightRef.current = true;
    const userText = draft.trim();
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: userText
          ? `${userText}\n\nFoto de Pedido enviada`
          : "Foto de Pedido enviada",
      },
    ]);
    setDraft("");
    setFeedback(null);
    setIsAnalyzingPhoto(true);
    setIsPending(true);
    const abortController = new AbortController();
    const timeout = window.setTimeout(() => abortController.abort(), 60_000);

    try {
      const formData = new FormData();
      formData.append("image", attachment.file);
      const response = await fetch("/api/assistant/order-photo/interpret", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });
      const result: unknown = await response.json().catch(() => null);
      const record =
        result && typeof result === "object" && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : null;
      const structuredBlock = response.ok
        ? parseAssistantStructuredBlock(record?.structuredBlock)
        : null;

      if (
        !response.ok ||
        !structuredBlock ||
        structuredBlock.kind !== "supplier_order_photo_preview"
      ) {
        throw new AssistantPhotoPreparationError(
          typeof record?.error === "string"
            ? record.error
            : "Não foi possível analisar este Pedido agora. Tente novamente.",
        );
      }

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            typeof record?.message === "string" && record.message.trim()
              ? record.message.trim()
              : structuredBlock.fallbackText,
          structuredBlock,
        },
      ]);
      setAttachment(null);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            error instanceof AssistantPhotoPreparationError
              ? error.message
              : "Não foi possível analisar este Pedido agora. Tente novamente.",
        },
      ]);
    } finally {
      window.clearTimeout(timeout);
      requestInFlightRef.current = false;
      setIsAnalyzingPhoto(false);
      setIsPending(false);
      shouldRestoreFocusRef.current = true;
    }
  }

  function replacePickupPreview(
    messageId: string,
    block: AssistantSupplierOrderPickupResultBlock,
  ) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content: block.message,
              structuredBlock: block,
              restoredMediaReferences: undefined,
            }
          : message,
      ),
    );
  }

  function parsePickupConfirmationResponse(
    value: unknown,
  ): AssistantSupplierOrderPickupConfirmationResult | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const block = parseAssistantStructuredBlock(record.block);
    const contextSupplierOrderId =
      record.contextSupplierOrderId;
    const contextSupplierOrderCatalogCode =
      record.contextSupplierOrderCatalogCode;

    if (
      keys.length !== 3 ||
      !keys.includes("block") ||
      !keys.includes("contextSupplierOrderId") ||
      !keys.includes("contextSupplierOrderCatalogCode") ||
      !block ||
      block.kind !== "assistant_action_result" ||
      (contextSupplierOrderId !== null &&
        (typeof contextSupplierOrderId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            contextSupplierOrderId,
          ))) ||
      (contextSupplierOrderCatalogCode !== null &&
        (typeof contextSupplierOrderCatalogCode !== "string" ||
          !contextSupplierOrderCatalogCode.trim() ||
          contextSupplierOrderCatalogCode.length > 80))
    ) {
      return null;
    }

    return {
      block,
      contextSupplierOrderId,
      contextSupplierOrderCatalogCode,
    };
  }

  async function handlePickupConfirmation(
    messageId: string,
    block: AssistantSupplierOrderPickupPreviewBlock,
  ) {
    if (
      actionInFlightRef.current ||
      requestInFlightRef.current ||
      isInteractionLocked ||
      block.state !== "pending" ||
      !block.proposalToken
    ) {
      return;
    }

    actionInFlightRef.current = true;
    setConfirmingPickupMessageId(messageId);
    setConfirmingPickupStage("validating");
    setIsPending(true);
    setFeedback(null);
    const registeringTimer = window.setTimeout(() => {
      setConfirmingPickupStage("registering");
    }, 500);

    try {
      const response = await fetch(
        "/api/assistant/actions/supplier-order-pickup",
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            proposalToken: block.proposalToken,
          }),
        },
      );
      const responseBody: unknown = await response.json();
      const result =
        parsePickupConfirmationResponse(responseBody);
      const parsedBlock = result?.block ?? null;

      if (
        !response.ok ||
        !result ||
        !parsedBlock ||
        parsedBlock.kind !== "assistant_action_result"
      ) {
        throw new Error("invalid_action_result");
      }

      setConfirmingPickupStage("refreshing");
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve());
        });
      });
      replacePickupPreview(messageId, parsedBlock);
      setConversationContext((current) => ({
        ...current,
        topic: result.contextSupplierOrderId ? "SUPPLIER_ORDER" : "GENERAL",
        itemQuery: null,
        itemReferenceKind: null,
        supplierOrderId: result.contextSupplierOrderId,
        supplierOrderCatalogCode:
          result.contextSupplierOrderCatalogCode,
        lastIntent: "supplier_order_pickup_result",
        suggestedFollowUp: null,
      }));

      if (
        parsedBlock.outcome === "success" ||
        parsedBlock.outcome === "no_change"
      ) {
        startStockRefresh(() => {
          router.refresh();
        });
      }
    } catch {
      replacePickupPreview(messageId, {
        kind: "assistant_action_result",
        action: "supplier_order_pickup",
        outcome: "error",
        title: "Resultado não confirmado",
        message:
          "Não foi possível confirmar o resultado da retirada. Confira o Pedido antes de realizar qualquer nova tentativa.",
        order: block.order,
        idempotentReplay: false,
        actions: [
          {
            kind: "link",
            label: "Abrir Pedido",
            href: block.order.href,
          },
        ],
      });
    } finally {
      window.clearTimeout(registeringTimer);
      actionInFlightRef.current = false;
      setConfirmingPickupMessageId(null);
      setConfirmingPickupStage(null);
      shouldRestoreFocusRef.current = true;
      setIsPending(false);
    }
  }

  function handlePickupCancellation(
    messageId: string,
    block: AssistantSupplierOrderPickupPreviewBlock,
  ) {
    if (
      actionInFlightRef.current ||
      isInteractionLocked ||
      block.state !== "pending"
    ) {
      return;
    }

    replacePickupPreview(messageId, {
      kind: "assistant_action_result",
      action: "supplier_order_pickup",
      outcome: "cancelled",
      title: "Prévia cancelada",
      message: "Nenhuma retirada foi executada.",
      order: block.order,
      idempotentReplay: false,
      actions: [
        {
          kind: "link",
          label: "Abrir Pedido",
          href: block.order.href,
        },
      ],
    });
    shouldRestoreFocusRef.current = true;
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  type StockEntryPreview =
    | AssistantSupplierOrderStockEntryPreviewBlock
    | AssistantManualStockEntryPreviewBlock;
  type StockEntryResult =
    | AssistantSupplierOrderStockEntryResultBlock
    | AssistantManualStockEntryResultBlock;

  function replaceStockEntryPreview(messageId: string, block: StockEntryResult) {
    setMessages((current) => current.map((message) => message.id === messageId
      ? { ...message, content: block.message, structuredBlock: block, leadText: undefined, followUpText: undefined, restoredMediaReferences: undefined }
      : message));
  }

  async function handleStockEntryConfirmation(messageId: string, block: StockEntryPreview) {
    if (actionInFlightRef.current || requestInFlightRef.current || isInteractionLocked ||
      block.state !== "pending" || !block.proposalToken) return;
    actionInFlightRef.current = true;
    setConfirmingStockEntryMessageId(messageId);
    setIsPending(true);
    setFeedback(null);
    try {
      const route = block.action === "supplier_order_stock_entry"
        ? "/api/assistant/actions/supplier-order-stock-entry"
        : "/api/assistant/actions/manual-stock-entry";
      const response = await fetch(route, { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposalToken: block.proposalToken }) });
      const body: unknown = await response.json().catch(() => null);
      const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
      const parsed = parseAssistantStructuredBlock(record?.block);
      const expectedKind = block.action === "supplier_order_stock_entry"
        ? "supplier_order_stock_entry_result" : "manual_stock_entry_result";
      if (!response.ok || !parsed || parsed.kind !== expectedKind) throw new Error("invalid_stock_entry_result");
      replaceStockEntryPreview(messageId, parsed as StockEntryResult);
      if (block.action === "supplier_order_stock_entry") {
        const contextId = record?.contextSupplierOrderId;
        setConversationContext((current) => ({
          ...current,
          topic: typeof contextId === "string" ? "SUPPLIER_ORDER" : "GENERAL",
          itemQuery: null,
          itemReferenceKind: null,
          supplierOrderId: typeof contextId === "string" ? contextId : null,
          supplierOrderCatalogCode: null,
          lastIntent: "supplier_order_stock_entry_result",
          suggestedFollowUp: null,
        }));
      }
      if (parsed.outcome === "success") startStockRefresh(() => router.refresh());
    } catch {
      const failed: StockEntryResult = block.action === "supplier_order_stock_entry"
        ? { kind: "supplier_order_stock_entry_result", action: "supplier_order_stock_entry", outcome: "error",
            title: "Resultado não confirmado", message: "Não foi possível confirmar o resultado. Confira o Pedido antes de tentar novamente.",
            order: block.order, lines: [], linesProcessed: 0, totalQuantity: 0, occurredAt: null, reference: null,
            idempotentReplay: false, actions: [{ kind: "link", label: "Abrir Pedido", href: block.order.href }] }
        : { kind: "manual_stock_entry_result", action: "manual_stock_entry", outcome: "error",
            title: "Resultado não confirmado", message: "Não foi possível confirmar o resultado. Confira o Estoque antes de tentar novamente.",
            lines: [], linesProcessed: 0, totalQuantity: 0, occurredAt: null, reference: null,
            idempotentReplay: false, actions: [{ kind: "link", label: "Abrir no Estoque", href: "/estoque" }] };
      replaceStockEntryPreview(messageId, failed);
    } finally {
      actionInFlightRef.current = false;
      setConfirmingStockEntryMessageId(null);
      shouldRestoreFocusRef.current = true;
      setIsPending(false);
    }
  }

  function handleStockEntryCancellation(messageId: string, block: StockEntryPreview) {
    if (actionInFlightRef.current || isInteractionLocked || block.state !== "pending") return;
    const cancelled: StockEntryResult = block.action === "supplier_order_stock_entry"
      ? { kind: "supplier_order_stock_entry_result", action: "supplier_order_stock_entry", outcome: "cancelled",
          title: "Prévia cancelada", message: "Nenhuma entrada foi executada.", order: block.order,
          lines: [], linesProcessed: 0, totalQuantity: 0, occurredAt: null, reference: null, idempotentReplay: false,
          actions: [{ kind: "link", label: "Abrir Pedido", href: block.order.href }] }
      : { kind: "manual_stock_entry_result", action: "manual_stock_entry", outcome: "cancelled",
          title: "Prévia cancelada", message: "Nenhuma entrada foi executada.", lines: [], linesProcessed: 0,
          totalQuantity: 0, occurredAt: null, reference: null, idempotentReplay: false, actions: [] };
    replaceStockEntryPreview(messageId, cancelled);
    shouldRestoreFocusRef.current = true;
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function replaceStockOutputPreview(messageId: string, block: AssistantManualStockOutputResultBlock) {
    setMessages((current) => current.map((message) => message.id === messageId
      ? { ...message, content: block.message, structuredBlock: block, leadText: undefined, followUpText: undefined, restoredMediaReferences: undefined }
      : message));
  }

  async function handleStockOutputConfirmation(messageId: string, block: AssistantManualStockOutputPreviewBlock) {
    if (actionInFlightRef.current || requestInFlightRef.current || isInteractionLocked ||
      block.state !== "pending" || !block.proposalToken) return;
    actionInFlightRef.current = true;
    setConfirmingStockOutputMessageId(messageId);
    setIsPending(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/assistant/actions/manual-stock-output", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalToken: block.proposalToken }),
      });
      const body: unknown = await response.json().catch(() => null);
      const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
      const parsed = parseAssistantStructuredBlock(record?.block);
      if (!response.ok || !parsed || parsed.kind !== "manual_stock_output_result") throw new Error("invalid_stock_output_result");
      replaceStockOutputPreview(messageId, parsed);
      if (parsed.outcome === "success") startStockRefresh(() => router.refresh());
    } catch {
      replaceStockOutputPreview(messageId, { kind: "manual_stock_output_result", action: "manual_stock_output", outcome: "error",
        title: "Resultado não confirmado", message: "Não foi possível confirmar o resultado. Confira o Estoque antes de tentar novamente.",
        lines: [], linesProcessed: 0, totalQuantity: 0, totalAutoAssemblyQuantity: 0, occurredAt: null,
        reference: null, idempotentReplay: false, actions: [{ kind: "link", label: "Abrir no Estoque", href: "/estoque" }] });
    } finally {
      actionInFlightRef.current = false;
      setConfirmingStockOutputMessageId(null);
      shouldRestoreFocusRef.current = true;
      setIsPending(false);
    }
  }

  function handleStockOutputCancellation(messageId: string, block: AssistantManualStockOutputPreviewBlock) {
    if (actionInFlightRef.current || isInteractionLocked || block.state !== "pending") return;
    replaceStockOutputPreview(messageId, { kind: "manual_stock_output_result", action: "manual_stock_output", outcome: "cancelled",
      title: "Prévia cancelada", message: "Nenhuma saída foi executada.", lines: [], linesProcessed: 0,
      totalQuantity: 0, totalAutoAssemblyQuantity: 0, occurredAt: null, reference: null,
      idempotentReplay: false, actions: [] });
    shouldRestoreFocusRef.current = true;
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function replaceConfigurationAssemblyPreview(messageId: string, block: AssistantConfigurationAssemblyResultBlock) {
    setMessages((current) => current.map((message) => message.id === messageId
      ? { ...message, content: block.message, structuredBlock: block, leadText: undefined, followUpText: undefined, restoredMediaReferences: undefined }
      : message));
  }

  async function handleConfigurationAssemblyConfirmation(
    messageId: string,
    block: AssistantConfigurationAssemblyPreviewBlock,
  ) {
    if (actionInFlightRef.current || requestInFlightRef.current || isInteractionLocked ||
      block.state !== "pending" || !block.proposalToken) return;
    actionInFlightRef.current = true;
    setConfirmingConfigurationAssemblyMessageId(messageId);
    setIsPending(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/assistant/actions/configuration-assembly", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalToken: block.proposalToken }),
      });
      const body: unknown = await response.json().catch(() => null);
      const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
      const parsed = parseAssistantStructuredBlock(record?.block);
      if (!response.ok || !parsed || parsed.kind !== "configuration_assembly_result") {
        throw new Error("invalid_configuration_assembly_result");
      }
      replaceConfigurationAssemblyPreview(messageId, parsed);
      if (parsed.outcome === "success") startStockRefresh(() => router.refresh());
    } catch {
      replaceConfigurationAssemblyPreview(messageId, { kind: "configuration_assembly_result", action: "configuration_assembly",
        outcome: "error", title: "Resultado não confirmado",
        message: "Não foi possível confirmar o resultado. Confira o Estoque antes de tentar novamente.",
        target: null, quantity: 0, mountedStockBefore: null, mountedStockAfter: null, servoStockBefore: null,
        servoStockAfter: null, installationKitStockBefore: null, installationKitStockAfter: null,
        occurredAt: null, reference: null, idempotentReplay: false,
        actions: [{ kind: "link", label: "Abrir no Estoque", href: "/estoque" }] });
    } finally {
      actionInFlightRef.current = false;
      setConfirmingConfigurationAssemblyMessageId(null);
      shouldRestoreFocusRef.current = true;
      setIsPending(false);
    }
  }

  function handleConfigurationAssemblyCancellation(
    messageId: string,
    block: AssistantConfigurationAssemblyPreviewBlock,
  ) {
    if (actionInFlightRef.current || isInteractionLocked || block.state !== "pending") return;
    replaceConfigurationAssemblyPreview(messageId, { kind: "configuration_assembly_result", action: "configuration_assembly",
      outcome: "cancelled", title: "Prévia cancelada", message: "Nenhuma montagem foi executada.", target: null,
      quantity: 0, mountedStockBefore: null, mountedStockAfter: null, servoStockBefore: null, servoStockAfter: null,
      installationKitStockBefore: null, installationKitStockAfter: null, occurredAt: null, reference: null,
      idempotentReplay: false, actions: [] });
    shouldRestoreFocusRef.current = true;
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function replaceConfigurationDisassemblyPreview(
    messageId: string,
    block: AssistantConfigurationDisassemblyResultBlock,
  ) {
    setMessages((current) => current.map((message) => message.id === messageId
      ? { ...message, content: block.message, structuredBlock: block, leadText: undefined, followUpText: undefined, restoredMediaReferences: undefined }
      : message));
  }

  async function handleConfigurationDisassemblyConfirmation(
    messageId: string,
    block: AssistantConfigurationDisassemblyPreviewBlock,
  ) {
    if (actionInFlightRef.current || requestInFlightRef.current || isInteractionLocked ||
      block.state !== "pending" || !block.proposalToken) return;
    actionInFlightRef.current = true;
    setConfirmingConfigurationDisassemblyMessageId(messageId);
    setIsPending(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/assistant/actions/configuration-disassembly", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalToken: block.proposalToken }),
      });
      const body: unknown = await response.json().catch(() => null);
      const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
      const parsed = parseAssistantStructuredBlock(record?.block);
      if (!response.ok || !parsed || parsed.kind !== "configuration_disassembly_result") {
        throw new Error("invalid_configuration_disassembly_result");
      }
      replaceConfigurationDisassemblyPreview(messageId, parsed);
      if (parsed.outcome === "success") startStockRefresh(() => router.refresh());
    } catch {
      replaceConfigurationDisassemblyPreview(messageId, {
        kind: "configuration_disassembly_result", action: "configuration_disassembly", outcome: "error",
        title: "Resultado não confirmado", message: "Não foi possível confirmar o resultado. Confira o Estoque antes de tentar novamente.",
        target: null, quantity: 0, mountedStockBefore: null, mountedStockAfter: null,
        servoStockBefore: null, servoStockAfter: null, installationKitStockBefore: null,
        installationKitStockAfter: null, occurredAt: null, reference: null, idempotentReplay: false,
        actions: [{ kind: "link", label: "Abrir no Estoque", href: "/estoque" }],
      });
    } finally {
      actionInFlightRef.current = false;
      setConfirmingConfigurationDisassemblyMessageId(null);
      shouldRestoreFocusRef.current = true;
      setIsPending(false);
    }
  }

  function handleConfigurationDisassemblyCancellation(
    messageId: string,
    block: AssistantConfigurationDisassemblyPreviewBlock,
  ) {
    if (actionInFlightRef.current || isInteractionLocked || block.state !== "pending") return;
    replaceConfigurationDisassemblyPreview(messageId, {
      kind: "configuration_disassembly_result", action: "configuration_disassembly", outcome: "cancelled",
      title: "Prévia cancelada", message: "Nenhuma desmontagem foi executada.", target: null,
      quantity: 0, mountedStockBefore: null, mountedStockAfter: null, servoStockBefore: null,
      servoStockAfter: null, installationKitStockBefore: null, installationKitStockAfter: null,
      occurredAt: null, reference: null, idempotentReplay: false, actions: [],
    });
    shouldRestoreFocusRef.current = true;
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function replaceSupplierOrderFinalizationPreview(
    messageId: string,
    block: AssistantSupplierOrderFinalizationResultBlock,
  ) {
    setMessages((current) => current.map((message) => message.id === messageId
      ? { ...message, content: block.message, structuredBlock: block, leadText: undefined, followUpText: undefined, restoredMediaReferences: undefined }
      : message));
  }

  async function handleSupplierOrderFinalizationConfirmation(
    messageId: string,
    block: AssistantSupplierOrderFinalizationPreviewBlock,
  ) {
    if (actionInFlightRef.current || requestInFlightRef.current || isInteractionLocked ||
      block.state !== "pending" || !block.proposalToken) return;
    actionInFlightRef.current = true;
    setConfirmingSupplierOrderFinalizationMessageId(messageId);
    setIsPending(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/assistant/actions/supplier-order-finalization", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposalToken: block.proposalToken }),
      });
      const body: unknown = await response.json().catch(() => null);
      const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
      const parsed = parseAssistantStructuredBlock(record?.block);
      if (!response.ok || !parsed || parsed.kind !== "supplier_order_finalization_result") {
        throw new Error("invalid_supplier_order_finalization_result");
      }
      replaceSupplierOrderFinalizationPreview(messageId, parsed);
      if (parsed.outcome === "success") startStockRefresh(() => router.refresh());
    } catch {
      replaceSupplierOrderFinalizationPreview(messageId, {
        kind: "supplier_order_finalization_result", action: "supplier_order_finalization", outcome: "error",
        title: "Resultado não confirmado", message: "Não foi possível confirmar a finalização. Confira o Pedido antes de tentar novamente.",
        order: null, occurredAt: null, idempotentReplay: false, actions: [{ kind: "link", label: "Abrir Pedidos", href: "/pedidos" }],
      });
    } finally {
      actionInFlightRef.current = false;
      setConfirmingSupplierOrderFinalizationMessageId(null);
      shouldRestoreFocusRef.current = true;
      setIsPending(false);
    }
  }

  function handleSupplierOrderFinalizationCancellation(
    messageId: string,
    block: AssistantSupplierOrderFinalizationPreviewBlock,
  ) {
    if (actionInFlightRef.current || isInteractionLocked || block.state !== "pending") return;
    replaceSupplierOrderFinalizationPreview(messageId, {
      kind: "supplier_order_finalization_result", action: "supplier_order_finalization", outcome: "cancelled",
      title: "Prévia cancelada", message: "Nenhum Pedido foi finalizado.", order: block.order,
      occurredAt: null, idempotentReplay: false, actions: [],
    });
    shouldRestoreFocusRef.current = true;
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit || requestInFlightRef.current) {
      return;
    }

    const submittedMessage = draft.trim();

    if (attachment) {
      void sendSupplierOrderPhoto();
      return;
    }

    if (submittedMessage) void sendAssistantMessage(submittedMessage);
  }

  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handleNewConversationRequest() {
    if (messages.length > 0) {
      setIsNewConversationDialogOpen(true);
      return;
    }

    resetConversation();
    setFeedback(null);
    setAttachment(null);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function confirmNewConversation() {
    setIsNewConversationDialogOpen(false);
    setFeedback(null);
    setAttachment(null);
    restoredConversationRef.current = null;
    resetConversation();
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleInternalNavigation(
    event: ReactMouseEvent<HTMLElement>,
  ) {
    const target = event.target;
    const anchor =
      target instanceof Element ? target.closest("a[href]") : null;
    const href = anchor?.getAttribute("href");

    if (href?.startsWith("/")) {
      persistNow({
        scrollTop: conversationRef.current?.scrollTop ?? 0,
      });
    }
  }

  return (
    <main
      onClickCapture={handleInternalNavigation}
      className="relative flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden lg:h-dvh"
    >
      <header className="shrink-0 border-b border-border-neutral/80 bg-app-background/95 px-4 py-2 backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-3xl justify-end">
          <button
            ref={newConversationButtonRef}
            type="button"
            disabled={!isHydrated || isInteractionLocked}
            onClick={handleNewConversationRequest}
            className="nk-focus inline-flex min-h-10 items-center gap-2 rounded-xl border border-border-neutral bg-surface px-3 text-sm font-black text-text-primary shadow-sm transition hover:border-brand-gold-dark hover:bg-brand-gold-soft/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusIcon aria-hidden="true" className="size-4" />
            Nova conversa
          </button>
        </div>
      </header>

      <section
        ref={conversationRef}
        aria-label="Conversa com a Assistente NK"
        onScroll={handleConversationScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 pt-4 pb-[calc(var(--assistant-composer-height,7rem)+env(safe-area-inset-bottom)+1rem)] sm:px-6 sm:pt-5 sm:pb-[calc(var(--assistant-composer-height,7rem)+env(safe-area-inset-bottom)+1.25rem)] lg:px-8 lg:pb-12">
          {!isHydrated ? (
            <p
              role="status"
              className="mx-auto my-auto rounded-xl border border-border-neutral bg-surface px-4 py-3 text-sm font-semibold text-text-muted shadow-sm"
            >
              Restaurando sua conversa...
            </p>
          ) : messages.length === 0 ? (
            <div className="mx-auto w-full max-w-3xl">
              <div className="mb-5 sm:mb-6">
                <p className="text-xl font-black tracking-tight text-text-primary sm:text-2xl">
                  {firstName ? `Olá, ${firstName}.` : "Olá."}
                </p>
                <p className="mt-1 text-sm font-semibold text-text-muted sm:text-base">
                  Consulte o Estoque, prepare operações ou envie uma foto de
                  Pedido. Toda alteração exige confirmação explícita.
                </p>
              </div>

              <div className="rounded-2xl border border-border-neutral bg-surface p-3 shadow-sm sm:p-4">
                <AssistantStructuredBlockView
                  block={initialSuggestions}
                  disabled={isInteractionLocked}
                  onPromptSelect={(prompt, context) => {
                    if (context?.openOrderPhotoPicker) {
                      setIsAttachmentMenuOpen(true);
                      window.requestAnimationFrame(() =>
                        attachmentMenuFirstItemRef.current?.focus(),
                      );
                      return;
                    }
                    void sendAssistantMessage(prompt);
                  }}
                />
              </div>

              <SafisaPickupAlertHomeSummary />

              <Link
                href="/estoque"
                className="nk-focus mt-4 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border-neutral bg-surface px-3 py-2 text-xs font-bold text-text-muted transition hover:border-brand-gold-dark hover:bg-brand-gold-soft/25"
              >
                <strong className="text-text-primary">
                  Resumo do estoque
                </strong>
                {stockError ? (
                  <span className="text-red-800">
                    Indisponível no momento
                  </span>
                ) : (
                  <>
                    <span>
                      {stockItems
                        .map(
                          ([label, value]) =>
                            `${quantityFormatter.format(value ?? 0)} ${label.toLocaleLowerCase("pt-BR")}`,
                        )
                        .join(" · ")}
                    </span>
                    <span className="text-orange-900">
                      {quantityFormatter.format(
                        summary?.lowStockItems ?? 0,
                      )}{" "}
                      baixos
                    </span>
                    <span className="text-red-800">
                      {quantityFormatter.format(
                        summary?.outOfStockItems ?? 0,
                      )}{" "}
                      zerados
                    </span>
                  </>
                )}
                <span className="ml-auto text-brand-gold-ink">
                  Abrir Estoque
                </span>
              </Link>
            </div>
          ) : (
            <div
              role="log"
              aria-live="polite"
              aria-atomic="false"
              aria-relevant="additions text"
              className="mx-auto flex w-full max-w-3xl flex-col gap-4"
            >
              {messages.map((chatMessage) => {
                const isStructured =
                  chatMessage.role === "assistant" &&
                  (Boolean(chatMessage.structuredBlock) ||
                    isStructuredAssistantMessage(chatMessage.content));

                if (chatMessage.role === "user") {
                  return (
                    <article
                      key={chatMessage.id}
                      className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-brand-charcoal px-4 py-3 text-sm leading-6 text-white shadow-sm sm:max-w-[78%] sm:text-base"
                    >
                      <span className="sr-only">Você: </span>
                      <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {chatMessage.content}
                      </span>
                    </article>
                  );
                }

                return (
                  <section
                    key={chatMessage.id}
                    aria-label="Resposta da Assistente NK"
                    className={`mr-auto min-w-0 ${
                      isStructured
                        ? "w-[96%] sm:w-[90%] lg:max-w-2xl"
                        : "w-fit max-w-[96%] lg:max-w-[82%]"
                    }`}
                  >
                    <div className="mb-1.5 flex items-center gap-2 px-1">
                      <span
                        aria-hidden="true"
                        className="flex size-7 items-center justify-center rounded-full bg-brand-charcoal text-[0.58rem] font-black tracking-wide text-brand-gold"
                      >
                        NK
                      </span>
                      <span className="text-xs font-black text-text-muted">
                        Assistente NK
                      </span>
                    </div>
                    <article className="rounded-2xl rounded-bl-md border border-border-neutral bg-surface px-4 py-3 text-sm leading-6 text-text-primary shadow-sm sm:text-base">
                      <span className="sr-only">Assistente NK: </span>
                      {chatMessage.structuredBlock ? (
                        <div className="space-y-3">
                          {chatMessage.leadText ? (
                            <AssistantMessageContent
                              content={chatMessage.leadText}
                            />
                          ) : null}
                          <AssistantStructuredBlockView
                          block={chatMessage.structuredBlock}
                          disabled={isInteractionLocked}
                          onPromptSelect={(prompt, context) => {
                            if (context?.openOrderPhotoPicker) {
                              setIsAttachmentMenuOpen(true);
                              window.requestAnimationFrame(() =>
                                attachmentMenuFirstItemRef.current?.focus(),
                              );
                              return;
                            }
                            if (context?.cancelStockEntry) {
                              setMessages((current) =>
                                current.map((message) =>
                                  message.id === chatMessage.id
                                    ? {
                                        ...message,
                                        content:
                                          "Prévia cancelada. Nenhuma operação foi executada.",
                                        structuredBlock: undefined,
                                      }
                                    : message,
                                ),
                              );
                              setFeedback("Entrada cancelada.");
                              return;
                            }
                            if (context?.cancelStockOutput) {
                              setMessages((current) => current.map((message) => message.id === chatMessage.id
                                ? { ...message, content: "Prévia cancelada. Nenhuma saída foi executada.", structuredBlock: undefined }
                                : message));
                              setFeedback("Saída cancelada.");
                              return;
                            }
                            if (context?.cancelConfigurationAssembly) {
                              setMessages((current) => current.map((message) => message.id === chatMessage.id
                                ? { ...message, content: "Prévia cancelada. Nenhuma montagem foi executada.", structuredBlock: undefined }
                                : message));
                              setFeedback("Montagem cancelada.");
                              return;
                            }
                            if (context?.cancelConfigurationDisassembly) {
                              setMessages((current) => current.map((message) => message.id === chatMessage.id
                                ? { ...message, content: "Prévia cancelada. Nenhuma desmontagem foi executada.", structuredBlock: undefined }
                                : message));
                              setFeedback("Desmontagem cancelada.");
                              return;
                            }
                            void sendAssistantMessage(prompt, context);
                          }}
                          onPickupConfirm={(block) => {
                            void handlePickupConfirmation(
                              chatMessage.id,
                              block,
                            );
                          }}
                          onPickupCancel={(block) => {
                            handlePickupCancellation(
                              chatMessage.id,
                              block,
                            );
                          }}
                          confirmingPickup={
                            confirmingPickupMessageId === chatMessage.id
                          }
                          pickupProgressLabel={
                            confirmingPickupMessageId === chatMessage.id &&
                            confirmingPickupStage
                              ? supplierOrderPickupProgressLabels[
                                  confirmingPickupStage
                                ]
                              : null
                          }
                          onStockEntryConfirm={(block) => {
                            void handleStockEntryConfirmation(chatMessage.id, block);
                          }}
                          onStockEntryCancel={(block) => {
                            handleStockEntryCancellation(chatMessage.id, block);
                          }}
                          confirmingStockEntry={confirmingStockEntryMessageId === chatMessage.id}
                          onStockOutputConfirm={(block) => {
                            void handleStockOutputConfirmation(chatMessage.id, block);
                          }}
                          onStockOutputCancel={(block) => {
                            handleStockOutputCancellation(chatMessage.id, block);
                          }}
                          confirmingStockOutput={confirmingStockOutputMessageId === chatMessage.id}
                          onConfigurationAssemblyConfirm={(block) => {
                            void handleConfigurationAssemblyConfirmation(chatMessage.id, block);
                          }}
                          onConfigurationAssemblyCancel={(block) => {
                            handleConfigurationAssemblyCancellation(chatMessage.id, block);
                          }}
                          confirmingConfigurationAssembly={confirmingConfigurationAssemblyMessageId === chatMessage.id}
                          onConfigurationDisassemblyConfirm={(block) => {
                            void handleConfigurationDisassemblyConfirmation(chatMessage.id, block);
                          }}
                          onConfigurationDisassemblyCancel={(block) => {
                            handleConfigurationDisassemblyCancellation(chatMessage.id, block);
                          }}
                          confirmingConfigurationDisassembly={confirmingConfigurationDisassemblyMessageId === chatMessage.id}
                          onSupplierOrderFinalizationConfirm={(block) => {
                            void handleSupplierOrderFinalizationConfirmation(chatMessage.id, block);
                          }}
                          onSupplierOrderFinalizationCancel={(block) => {
                            handleSupplierOrderFinalizationCancellation(chatMessage.id, block);
                          }}
                          confirmingSupplierOrderFinalization={confirmingSupplierOrderFinalizationMessageId === chatMessage.id}
                          onSupplierOrderPhotoUpdate={(block) => {
                            setMessages((current) => current.map((message) => message.id === chatMessage.id
                              ? { ...message, content: block.fallbackText, structuredBlock: block }
                              : message));
                          }}
                          />
                          {chatMessage.followUpText ? (
                            <div className="border-t border-border-neutral pt-3 text-text-muted">
                              <AssistantMessageContent
                                content={chatMessage.followUpText}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <AssistantMessageContent
                            content={chatMessage.content}
                          />
                          {chatMessage.followUpText ? (
                            <div className="text-text-muted">
                              <AssistantMessageContent
                                content={chatMessage.followUpText}
                              />
                            </div>
                          ) : null}
                        </div>
                      )}
                      {chatMessage.restoredMediaReferences?.length ? (
                        <div
                          className="mt-3 flex flex-wrap gap-2 border-t border-border-neutral pt-3"
                          aria-label="Fotos disponíveis nesta resposta"
                        >
                          {chatMessage.restoredMediaReferences.map(
                            (reference) => (
                              <AssistantRestoredMediaControl
                                key={`${reference.code}-${reference.targetKind ?? "catalog"}-${reference.targetId ?? ""}`}
                                reference={reference}
                                disabled={isInteractionLocked}
                              />
                            ),
                          )}
                        </div>
                      ) : null}
                    </article>
                  </section>
                );
              })}
              {isInteractionLocked && !hasOperationalConfirmation ? (
                <section
                  role="status"
                  aria-label="Resposta da Assistente NK em andamento"
                  className="mr-auto"
                >
                  <div className="mb-1.5 flex items-center gap-2 px-1">
                    <span
                      aria-hidden="true"
                      className="flex size-7 items-center justify-center rounded-full bg-brand-charcoal text-[0.58rem] font-black text-brand-gold"
                    >
                      NK
                    </span>
                    <span className="text-xs font-black text-text-muted">
                      Assistente NK
                    </span>
                  </div>
                  <div className="rounded-2xl rounded-bl-md border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-900 shadow-sm">
                    {isPending
                      ? isAnalyzingPhoto
                        ? "Analisando Pedido..."
                        : "Consultando..."
                      : "Atualizando os dados..."}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <div ref={composerRef} className="z-30 shrink-0 border-t border-border-neutral/80 bg-app-background/95 px-4 pt-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-6 sm:pt-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:px-8">
          <form
            onSubmit={handleSubmit}
            aria-busy={isComposerLocked}
            className="mx-auto w-full max-w-3xl rounded-2xl border border-border-neutral bg-surface p-2 shadow-[0_16px_42px_-26px_rgba(23,29,33,0.6)]"
          >
            {attachment ? (
              <div className="mb-2 flex items-center gap-3 rounded-xl bg-violet-50 p-2 pr-3">
                <div className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-violet-200 bg-white">
                  <Image
                    src={attachment.previewUrl}
                    alt="Prévia da imagem selecionada"
                    fill
                    unoptimized
                    sizes="56px"
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-black text-text-primary">
                    {attachment.file.name}
                  </p>
                  <p className="mt-0.5 text-[0.68rem] font-semibold text-text-muted">
                    {attachment.source === "camera"
                      ? "Foto da câmera"
                      : "Imagem da galeria"}
                    {" · "}
                    {attachment.status === "preparing"
                      ? "preparando"
                      : "pronta para análise"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isComposerLocked}
                  onClick={removeAttachment}
                  aria-label="Remover imagem anexada"
                  className="nk-focus inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-text-muted transition hover:bg-white hover:text-red-800"
                >
                  <CloseIcon className="size-5" />
                </button>
              </div>
            ) : null}

            <div className="flex items-end gap-1.5 sm:gap-2">
              <div className="relative shrink-0">
                <button
                  ref={menuButtonRef}
                  type="button"
                  disabled={isComposerLocked}
                  aria-label="Adicionar imagem"
                  aria-expanded={isAttachmentMenuOpen}
                  aria-controls={attachmentMenuId}
                  onClick={() =>
                    setIsAttachmentMenuOpen((current) => !current)
                  }
                  className="nk-focus inline-flex size-11 items-center justify-center rounded-xl bg-app-background text-text-primary transition hover:bg-brand-gold-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PlusIcon className="size-5" />
                </button>

                {isAttachmentMenuOpen ? (
                  <div
                    ref={attachmentMenuRef}
                    id={attachmentMenuId}
                    aria-label="Opções de imagem"
                    className="absolute bottom-[calc(100%+0.65rem)] left-0 z-40 w-60 overflow-hidden rounded-2xl border border-border-neutral bg-surface p-2 shadow-xl"
                  >
                    <button
                      ref={attachmentMenuFirstItemRef}
                      type="button"
                      onClick={() => {
                        setIsAttachmentMenuOpen(false);
                        cameraInputRef.current?.click();
                      }}
                      className="nk-focus flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-black text-text-primary transition hover:bg-app-background"
                    >
                      <CameraIcon className="size-5 text-sky-700" />
                      Tirar foto
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAttachmentMenuOpen(false);
                        galleryInputRef.current?.click();
                      }}
                      className="nk-focus flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-black text-text-primary transition hover:bg-app-background"
                    >
                      <ImageIcon className="size-5 text-violet-700" />
                      Escolher da galeria
                    </button>
                  </div>
                ) : null}
              </div>

              <label className="min-w-0 flex-1">
                <span className="sr-only">Mensagem para a Assistente NK</span>
                <textarea
                  ref={textareaRef}
                  value={draft}
                  rows={1}
                  maxLength={assistantMessageMaxLength}
                  disabled={isComposerLocked}
                  placeholder="Digite uma mensagem..."
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setFeedback(null);
                    resizeTextarea();
                  }}
                  onKeyDown={handleTextareaKeyDown}
                  className="nk-field block max-h-32 min-h-11 w-full resize-none overflow-y-auto rounded-xl border px-3 py-2.5 text-sm leading-6 outline-none sm:text-base"
                />
              </label>

              <button
                type="submit"
                disabled={!canSubmit}
                aria-label="Enviar mensagem"
                className="nk-focus inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-700 to-blue-700 text-white transition hover:from-violet-800 hover:to-blue-800 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <SendIcon className="size-5" />
              </button>
            </div>

            {feedback ? (
              <p
                role="status"
                className="mt-2 px-1 text-xs leading-5 font-semibold text-text-muted"
              >
                {feedback}
              </p>
            ) : null}

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(event) => void handleImageSelection(event, "camera")}
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => void handleImageSelection(event, "gallery")}
            />
          </form>
          <p className="mx-auto mt-1 max-w-3xl text-center text-[0.6rem] leading-4 font-semibold text-text-muted sm:mt-1.5 sm:text-[0.68rem]">
            Consultas e fotos de Pedido geram prévias. Entradas, saídas,
            montagens e retiradas só acontecem após confirmação explícita.
          </p>
      </div>

      <AssistantNewConversationDialog
        isOpen={isNewConversationDialogOpen}
        onCancel={() => {
          setIsNewConversationDialogOpen(false);
          window.requestAnimationFrame(() =>
            newConversationButtonRef.current?.focus(),
          );
        }}
        onConfirm={confirmNewConversation}
      />
      <PwaInstallPrompt />
    </main>
  );
}
