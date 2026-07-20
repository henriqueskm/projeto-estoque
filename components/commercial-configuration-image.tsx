"use client";

/* eslint-disable @next/next/no-img-element -- Private, expiring Storage URLs should be loaded directly by the browser. */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type CommercialConfigurationImageProps = {
  commercialCodes: string[];
  imageUrl: string | null;
  compact?: boolean;
  triggerVariant?: "thumbnail" | "menu-item" | "text-link";
};

const minimumZoom = 1;
const maximumZoom = 3;
const zoomStep = 0.5;

export function CommercialConfigurationImage({
  commercialCodes,
  imageUrl,
  compact = false,
  triggerVariant = "thumbnail",
}: CommercialConfigurationImageProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [zoom, setZoom] = useState(minimumZoom);
  const dialogTitleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const codeLabel = commercialCodes.join(" / ");
  const altText = `Foto da configuração comercial ${codeLabel}`;

  const closeModal = useCallback(() => {
    setIsOpen(false);
    setZoom(minimumZoom);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLButtonElement>(
          "button:not([disabled])",
        ),
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (!firstElement || !lastElement) {
        return;
      }

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeModal, isOpen]);

  if (!imageUrl) {
    return (
      <p
        className={
          compact
            ? "mt-2 text-xs font-semibold text-text-muted"
            : "mt-4 rounded-xl border border-dashed border-border-neutral bg-app-background px-3 py-3 text-sm font-semibold text-text-muted"
        }
      >
        Foto não disponível
      </p>
    );
  }

  const isMenuItem = triggerVariant === "menu-item";
  const isTextLink = triggerVariant === "text-link";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setZoom(minimumZoom);
          setIsOpen(true);
        }}
        role={isMenuItem ? "menuitem" : undefined}
        aria-label={`${isMenuItem || isTextLink ? "Visualizar" : "Ampliar"} ${altText.toLocaleLowerCase("pt-BR")}`}
        className={
          isMenuItem
            ? "nk-focus flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-bold text-text-primary transition hover:bg-app-background"
            : isTextLink
              ? "nk-focus mt-0.5 inline-flex min-h-11 items-center rounded-lg px-0.5 text-[0.65rem] font-bold text-violet-800"
            : `nk-focus group mt-4 block overflow-hidden rounded-xl border border-border-neutral bg-app-background text-left shadow-sm transition hover:border-brand-gold-dark ${
                compact ? "w-28" : "w-full max-w-64"
              }`
        }
      >
        {isMenuItem ? (
          "Visualizar imagem"
        ) : isTextLink ? (
          <span className="rounded-md border border-violet-200 bg-surface px-1.5 py-1 leading-4 transition hover:border-violet-400 hover:bg-violet-50">
            Ver foto
          </span>
        ) : (
          <>
            <span
              className={`flex items-center justify-center overflow-hidden bg-white ${
                compact ? "h-20" : "h-36 sm:h-40"
              }`}
            >
              <img
                src={imageUrl}
                alt={altText}
                loading="lazy"
                className="max-h-full max-w-full object-contain transition duration-200 group-hover:scale-[1.02]"
              />
            </span>
            <span className="block px-3 py-2 text-center text-xs font-bold text-brand-gold-ink">
              Ver foto ampliada
            </span>
          </>
        )}
      </button>

      {isOpen ? (
        <div
          ref={dialogRef}
          role="dialog"
          data-commercial-image-dialog="true"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
          className="fixed inset-0 z-[100] flex bg-black/95 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] sm:p-5"
        >
          <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-hidden rounded-2xl border border-white/15 bg-brand-charcoal shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/15 px-3 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-300">
                  Configuração comercial
                </p>
                <h2
                  id={dialogTitleId}
                  className="truncate font-mono text-lg font-black text-brand-gold sm:text-xl"
                >
                  {codeLabel}
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <div
                  className="flex items-center rounded-xl border border-white/20 bg-black/30"
                  aria-label="Controles de zoom"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((currentZoom) =>
                        Math.max(minimumZoom, currentZoom - zoomStep),
                      )
                    }
                    disabled={zoom <= minimumZoom}
                    aria-label="Diminuir zoom"
                    className="nk-focus flex size-11 items-center justify-center rounded-l-xl text-xl font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    −
                  </button>
                  <span
                    aria-live="polite"
                    className="min-w-14 text-center text-xs font-bold text-white"
                  >
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((currentZoom) =>
                        Math.min(maximumZoom, currentZoom + zoomStep),
                      )
                    }
                    disabled={zoom >= maximumZoom}
                    aria-label="Aumentar zoom"
                    className="nk-focus flex size-11 items-center justify-center rounded-r-xl text-xl font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    +
                  </button>
                </div>

                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={closeModal}
                  aria-label="Fechar foto ampliada"
                  className="nk-focus inline-flex min-h-11 items-center justify-center rounded-xl border border-white/25 bg-white px-4 text-sm font-black text-brand-charcoal transition hover:bg-slate-100"
                >
                  Fechar
                </button>
              </div>
            </div>

            <div
              className="min-h-0 flex-1 overflow-auto overscroll-contain"
              style={{ touchAction: "pan-x pan-y pinch-zoom" }}
            >
              <div
                className="flex min-h-full min-w-full items-center justify-center p-3 sm:p-5"
                style={{
                  height: `${zoom * 100}%`,
                  width: `${zoom * 100}%`,
                }}
              >
                <img
                  src={imageUrl}
                  alt={altText}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
