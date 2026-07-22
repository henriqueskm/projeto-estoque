"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  AssistantIcon,
  CameraIcon,
  CloseIcon,
  ImageIcon,
  InboundIcon,
  MicrophoneIcon,
  OutboundIcon,
  PlusIcon,
  SendIcon,
  StockIcon,
} from "@/components/icons";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { useAuthenticatedProfile } from "@/components/authenticated-profile-provider";
import type { StockSummary } from "@/lib/home-data";

type AssistantHomeProps = {
  summary: StockSummary | null;
  stockError: string | null;
};

type LocalAttachment = {
  file: File;
  previewUrl: string;
  source: "camera" | "gallery";
};

const suggestions = [
  {
    label: "Consultar estoque",
    message: "Quero consultar meu estoque",
    icon: StockIcon,
  },
  {
    label: "Registrar uma entrada",
    message: "Quero registrar uma entrada",
    icon: InboundIcon,
  },
  {
    label: "Registrar uma saída",
    message: "Quero registrar uma saída",
    icon: OutboundIcon,
  },
  {
    label: "Analisar foto de pedido",
    message: "Quero analisar uma foto de pedido",
    icon: CameraIcon,
    opensAttachmentMenu: true,
  },
] as const;

const quantityFormatter = new Intl.NumberFormat("pt-BR");

export function AssistantHome({
  summary,
  stockError,
}: AssistantHomeProps) {
  const profile = useAuthenticatedProfile();
  const [message, setMessage] = useState("");
  const [attachment, setAttachment] = useState<LocalAttachment | null>(null);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuId = useId();
  const firstName = profile.hasRegisteredName
    ? (profile.displayName.split(/\s+/).filter(Boolean)[0] ?? null)
    : null;
  const canSubmit = Boolean(message.trim() || attachment);
  const stockItems = [
    ["Caixas", summary?.completeBoxesTotal],
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
    if (!isAttachmentMenuOpen) {
      return;
    }

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

  function resizeTextarea() {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }

  function selectSuggestion(
    suggestionMessage: string,
    opensAttachmentMenu = false,
  ) {
    setMessage(suggestionMessage);
    setFeedback(null);

    if (opensAttachmentMenu) {
      setIsAttachmentMenuOpen(true);
      window.requestAnimationFrame(() => {
        resizeTextarea();
        attachmentMenuRef.current
          ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
          ?.focus();
      });
      return;
    }

    window.requestAnimationFrame(() => {
      resizeTextarea();
      textareaRef.current?.focus();
    });
  }

  function handleImageSelection(
    event: ChangeEvent<HTMLInputElement>,
    source: LocalAttachment["source"],
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setFeedback("Escolha um arquivo de imagem válido.");
      return;
    }

    setAttachment({
      file,
      previewUrl: URL.createObjectURL(file),
      source,
    });
    setFeedback(
      "Imagem anexada somente neste dispositivo. Nada foi enviado ainda.",
    );
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function removeAttachment() {
    setAttachment(null);
    setFeedback("Imagem removida.");
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setFeedback(
      "Assistente IA ainda não conectado. Sua mensagem e seu anexo não foram enviados.",
    );
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

  return (
    <main className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden lg:h-dvh">
      <section
        aria-label="Conversa com o Assistente IA"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col justify-start px-4 pt-3 pb-5 sm:px-6 sm:pt-5 sm:pb-7 lg:justify-center lg:px-8 lg:py-10">
          <div className="mx-auto w-full max-w-3xl text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-700 to-blue-700 text-white shadow-[0_16px_32px_-20px_rgba(76,29,149,0.9)] sm:size-14">
              <AssistantIcon className="size-7 sm:size-8" />
            </span>
            <p className="mt-3 text-xs font-black tracking-[0.12em] text-brand-gold-ink uppercase sm:mt-4 sm:text-sm">
              Assistente IA
            </p>
            <h1 className="mt-1.5 text-2xl font-black tracking-tight text-text-primary sm:text-4xl">
              {firstName
                ? `Bem-vindo de volta, ${firstName}.`
                : "Bem-vindo de volta."}
            </h1>
            <p className="mt-1 text-lg font-bold text-text-muted sm:mt-2 sm:text-2xl">
              Como posso te ajudar?
            </p>
          </div>

          <Link
            href="/estoque"
            className="nk-focus mx-auto mt-5 block w-full max-w-3xl rounded-2xl border border-border-neutral bg-surface px-3 py-2.5 text-left shadow-sm transition hover:border-brand-gold-dark hover:shadow-md sm:mt-6 sm:px-4 sm:py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black tracking-[0.12em] text-text-muted uppercase">
                Resumo do estoque
              </p>
              <span className="text-xs font-black text-brand-gold-ink">
                Ver estoque
              </span>
            </div>
            {stockError ? (
              <p className="mt-2 text-sm font-semibold text-red-800">
                Resumo indisponível no momento.
              </p>
            ) : (
              <div className="mt-2 grid grid-cols-5 gap-1.5 sm:gap-2">
                {stockItems.map(([label, value]) => (
                  <span
                    key={label}
                    className="min-w-0 rounded-lg bg-app-background px-1 py-1.5 text-center sm:rounded-xl sm:px-2 sm:py-2"
                  >
                    <span className="block text-base font-black tabular-nums text-text-primary sm:text-lg">
                      {value === undefined
                        ? "—"
                        : quantityFormatter.format(value)}
                    </span>
                    <span className="block truncate text-[0.58rem] leading-3.5 font-bold text-text-muted sm:text-[0.68rem] sm:leading-4">
                      {label}
                    </span>
                  </span>
                ))}
              </div>
            )}
            {!stockError ? (
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[0.68rem] font-black sm:mt-2 sm:gap-2 sm:text-xs">
                <span className="rounded-lg bg-orange-50 px-2.5 py-1.5 text-orange-900 sm:px-3 sm:py-2">
                  {quantityFormatter.format(summary?.lowStockItems ?? 0)} baixos
                </span>
                <span className="rounded-lg bg-red-50 px-2.5 py-1.5 text-red-900 sm:px-3 sm:py-2">
                  {quantityFormatter.format(summary?.outOfStockItems ?? 0)} zerados
                </span>
              </div>
            ) : null}
          </Link>

          <div className="mx-auto mt-4 grid w-full max-w-3xl grid-cols-2 gap-2 sm:mt-5 sm:gap-3">
            {suggestions.map((suggestion) => {
              const Icon = suggestion.icon;

              return (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() =>
                    selectSuggestion(
                      suggestion.message,
                      "opensAttachmentMenu" in suggestion,
                    )
                  }
                  className="nk-focus flex min-h-12 items-center gap-2.5 rounded-xl border border-border-neutral bg-surface px-3 py-2 text-left text-xs font-black text-text-primary shadow-sm transition hover:border-violet-300 hover:bg-violet-50 sm:min-h-14 sm:rounded-2xl sm:px-4 sm:text-sm"
                >
                  <Icon className="size-5 shrink-0 text-violet-700" />
                  <span>{suggestion.label}</span>
                </button>
              );
            })}
          </div>

        </div>
      </section>

      <div className="z-30 shrink-0 border-t border-border-neutral/80 bg-app-background/95 px-4 pt-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-6 sm:pt-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:px-8">
          <form
            onSubmit={handleSubmit}
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
                    {" · "}somente local
                  </p>
                </div>
                <button
                  type="button"
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
                  aria-label="Adicionar imagem"
                  aria-haspopup="menu"
                  aria-expanded={isAttachmentMenuOpen}
                  aria-controls={attachmentMenuId}
                  onClick={() =>
                    setIsAttachmentMenuOpen((current) => !current)
                  }
                  className="nk-focus inline-flex size-11 items-center justify-center rounded-xl bg-app-background text-text-primary transition hover:bg-brand-gold-soft"
                >
                  <PlusIcon className="size-5" />
                </button>

                {isAttachmentMenuOpen ? (
                  <div
                    ref={attachmentMenuRef}
                    id={attachmentMenuId}
                    role="menu"
                    aria-label="Opções de imagem"
                    className="absolute bottom-[calc(100%+0.65rem)] left-0 z-40 w-60 overflow-hidden rounded-2xl border border-border-neutral bg-surface p-2 shadow-xl"
                  >
                    <button
                      type="button"
                      role="menuitem"
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
                      role="menuitem"
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
                <span className="sr-only">Mensagem para o Assistente IA</span>
                <textarea
                  ref={textareaRef}
                  value={message}
                  rows={1}
                  maxLength={2000}
                  placeholder="Digite uma mensagem..."
                  onChange={(event) => {
                    setMessage(event.target.value);
                    setFeedback(null);
                    resizeTextarea();
                  }}
                  onKeyDown={handleTextareaKeyDown}
                  className="nk-field block max-h-32 min-h-11 w-full resize-none overflow-y-auto rounded-xl border px-3 py-2.5 text-sm leading-6 outline-none sm:text-base"
                />
              </label>

              <button
                type="button"
                aria-label="Usar microfone"
                onClick={() =>
                  setFeedback("Entrada por voz está em preparação.")
                }
                className="nk-focus inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-app-background text-text-primary transition hover:bg-violet-50 hover:text-violet-800"
              >
                <MicrophoneIcon className="size-5" />
              </button>

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
              onChange={(event) => handleImageSelection(event, "camera")}
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => handleImageSelection(event, "gallery")}
            />
          </form>
          <p className="mx-auto mt-1 max-w-3xl text-center text-[0.6rem] leading-4 font-semibold text-text-muted sm:mt-1.5 sm:text-[0.68rem]">
            O Assistente IA ainda não está conectado e não executa operações.
          </p>
      </div>

      <PwaInstallPrompt />
    </main>
  );
}
