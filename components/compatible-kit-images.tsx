"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CommercialConfigurationImage } from "@/components/commercial-configuration-image";
import { EyeIcon } from "@/components/icons";
import type { CompatibleKitImageOption } from "@/lib/compatible-kit-images";
import { useDocumentScrollLock } from "@/lib/use-document-scroll-lock";

type CompatibleKitImagesProps = {
  kitCode: string;
  options: CompatibleKitImageOption[];
  triggerVariant?: "icon-button" | "assistant-action";
};

export function CompatibleKitImages({
  kitCode,
  options,
  triggerVariant = "icon-button",
}: CompatibleKitImagesProps) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDocumentScrollLock(isOpen);

  const closeSelector = useCallback(() => {
    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (
          document.querySelector('[data-commercial-image-dialog="true"]')
        ) {
          return;
        }

        event.preventDefault();
        closeSelector();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
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
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeSelector, isOpen]);

  if (options.length === 0) {
    return null;
  }

  const actionLabel =
    options.length === 1
      ? `Ver foto do kit ${kitCode}`
      : `Ver fotos do kit ${kitCode}`;

  if (options.length === 1) {
    const option = options[0];

    return (
      <CommercialConfigurationImage
        commercialCodes={option.commercialCodes}
        imageUrl={option.imageUrl}
        triggerLabel={actionLabel}
        triggerVariant={triggerVariant}
      />
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={actionLabel}
        title={actionLabel}
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen(true);
        }}
        className={
          triggerVariant === "assistant-action"
            ? "nk-focus inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 px-3 text-xs font-black text-violet-900 transition hover:border-violet-400 hover:bg-violet-100"
            : "nk-focus inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet-200 bg-violet-50 text-violet-800 transition hover:border-violet-400 hover:bg-violet-100"
        }
      >
        {triggerVariant === "assistant-action" ? (
          "Ver fotos"
        ) : (
          <EyeIcon className="size-4" />
        )}
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={dialogRef}
              role="dialog"
              data-compatible-kit-images-dialog="true"
              aria-modal="true"
              aria-labelledby={titleId}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  closeSelector();
                }
              }}
              className="fixed inset-0 z-[190] flex h-dvh items-center justify-center overflow-y-auto bg-black/65 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] sm:p-6"
            >
              <section className="my-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-border-neutral bg-surface shadow-2xl">
                <header className="flex items-start justify-between gap-3 border-b border-border-neutral bg-brand-charcoal px-4 py-3 text-white sm:px-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-gold">
                      Fotos compatíveis
                    </p>
                    <h2 id={titleId} className="mt-0.5 text-lg font-black">
                      Kit {kitCode}
                    </h2>
                    <p className="mt-1 text-xs font-semibold text-slate-300">
                      Escolha a configuração física que deseja visualizar.
                    </p>
                  </div>
                  <button
                    ref={closeButtonRef}
                    type="button"
                    onClick={closeSelector}
                    className="nk-focus inline-flex min-h-11 shrink-0 items-center rounded-xl border border-white/25 bg-white px-4 text-sm font-black text-brand-charcoal"
                  >
                    Fechar
                  </button>
                </header>

                <div className="max-h-[min(68dvh,38rem)] space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-5">
                  {options.map((option) => {
                    const commercialLabel =
                      option.commercialCodes.join(" / ");
                    const servoLabel =
                      option.servoModel?.trim() ||
                      option.servoDescription;

                    return (
                      <article
                        key={option.configurationId}
                        className="rounded-xl border border-border-neutral bg-app-background p-3 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:p-4"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-base font-black text-violet-900">
                            {commercialLabel}
                          </p>
                          <p className="mt-1 break-words text-sm font-bold text-text-primary">
                            {option.description}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-text-muted">
                            Servo {option.servoCode} · {servoLabel}
                          </p>
                          <p className="text-xs font-semibold text-text-muted">
                            Kit {option.installationKitCode}
                          </p>
                        </div>
                        <div className="mt-3 sm:mt-0">
                          <CommercialConfigurationImage
                            commercialCodes={option.commercialCodes}
                            imageUrl={option.imageUrl}
                            triggerLabel={`Ver foto de ${commercialLabel}`}
                            triggerVariant="selector-action"
                          />
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
