"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { logout } from "@/app/auth/actions";
import { ChevronDownIcon, LogoutIcon } from "@/components/icons";

type AccountMenuProps = {
  fullName: string;
  email: string;
  hasRegisteredName: boolean;
};

function getInitials(fullName: string, hasRegisteredName: boolean) {
  if (!hasRegisteredName) {
    return "?";
  }

  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstPart = Array.from(nameParts[0] ?? "");
  const lastPart = Array.from(nameParts.at(-1) ?? "");
  const initials =
    nameParts.length === 1
      ? firstPart.slice(0, 2)
      : [firstPart[0], lastPart[0]];

  return initials.filter(Boolean).join("").toLocaleUpperCase("pt-BR");
}

function getFirstName(fullName: string, hasRegisteredName: boolean) {
  if (!hasRegisteredName) {
    return fullName;
  }

  return fullName.split(/\s+/)[0] || fullName;
}

export function AccountMenu({
  fullName,
  email,
  hasRegisteredName,
}: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const initials = getInitials(fullName, hasRegisteredName);
  const firstName = getFirstName(fullName, hasRegisteredName);

  function focusMenuItem(position: "first" | "last") {
    window.requestAnimationFrame(() => {
      const menuItems =
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');

      if (!menuItems?.length) {
        return;
      }

      menuItems[position === "first" ? 0 : menuItems.length - 1]?.focus();
    });
  }

  function openMenu(position: "first" | "last" = "first") {
    setIsOpen(true);
    focusMenuItem(position);
  }

  function closeMenu({ restoreFocus = false } = {}) {
    setIsOpen(false);

    if (restoreFocus) {
      window.requestAnimationFrame(() => buttonRef.current?.focus());
    }
  }

  function handleButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu("first");
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu("last");
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const currentIndex = menuItems.indexOf(
      document.activeElement as HTMLElement,
    );

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu({ restoreFocus: true });
      return;
    }

    if (event.key === "Tab") {
      closeMenu();
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();

    if (event.key === "Home") {
      menuItems[0]?.focus();
      return;
    }

    if (event.key === "End") {
      menuItems.at(-1)?.focus();
      return;
    }

    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      currentIndex < 0
        ? direction > 0
          ? 0
          : menuItems.length - 1
        : (currentIndex + direction + menuItems.length) % menuItems.length;

    menuItems[nextIndex]?.focus();
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        closeMenu();
      }
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu({ restoreFocus: true });
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => {
          if (isOpen) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
        onKeyDown={handleButtonKeyDown}
        className="nk-focus flex min-h-11 max-w-44 min-w-0 items-center gap-2 rounded-xl border border-brand-gold/45 bg-white/6 px-2 py-1.5 text-left text-white transition hover:border-brand-gold hover:bg-white/10 sm:max-w-64 sm:gap-2.5 sm:px-3"
      >
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-brand-gold/80 bg-brand-gold text-xs font-black tracking-wide text-brand-charcoal shadow-sm"
        >
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block max-w-20 truncate text-xs font-black sm:hidden">
            {firstName}
          </span>
          <span className="hidden max-w-44 truncate text-sm font-black sm:block">
            {fullName}
          </span>
        </span>
        <ChevronDownIcon
          className={`size-4 shrink-0 text-brand-gold transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Menu da conta"
          onKeyDown={handleMenuKeyDown}
          className="absolute top-[calc(100%+0.65rem)] right-0 z-50 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-brand-gold/35 bg-surface text-text-primary shadow-[0_22px_60px_-22px_rgba(0,0,0,0.72)]"
        >
          <div
            role="group"
            aria-label="Dados da conta"
            className="border-b border-border-neutral bg-brand-gold-soft/55 px-4 py-4"
          >
            <p className="break-words text-sm font-black text-brand-charcoal">
              {fullName}
            </p>
            <p className="mt-1 break-all text-xs font-semibold text-text-muted">
              {email}
            </p>
            {!hasRegisteredName ? (
              <p className="mt-2 text-xs font-bold leading-5 text-brand-gold-ink">
                O administrador precisa completar seu cadastro.
              </p>
            ) : null}
          </div>

          <div role="group" aria-label="Ações da conta" className="p-2">
            <Link
              href="/minha-conta"
              role="menuitem"
              onClick={() => closeMenu()}
              className="nk-focus flex min-h-11 items-center rounded-xl px-3 text-sm font-bold transition hover:bg-brand-gold-soft/70"
            >
              Minha conta
            </Link>

            <form action={logout} role="none">
              <button
                type="submit"
                role="menuitem"
                className="nk-focus flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-bold text-red-800 transition hover:bg-red-50"
              >
                <LogoutIcon className="size-4" />
                Sair
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
