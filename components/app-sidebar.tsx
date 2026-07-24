"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { logout } from "@/app/auth/actions";
import { BrandMark } from "@/components/brand-mark";
import {
  AssistantIcon,
  ChevronDownIcon,
  ClockIcon,
  CloseIcon,
  InboundIcon,
  LogoutIcon,
  MenuIcon,
  OrdersIcon,
  OutboundIcon,
  StatisticsIcon,
  StockIcon,
} from "@/components/icons";

type AppSidebarProps = {
  userName: string;
  hasRegisteredName: boolean;
};

type NavigationContentProps = AppSidebarProps & {
  idSuffix: string;
  pathname: string;
  operationsExpanded: boolean;
  onToggleOperations: () => void;
  onNavigate?: () => void;
};

function isCurrentSection(pathname: string, href: string) {
  if (href === "/") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function getInitials(userName: string, hasRegisteredName: boolean) {
  if (!hasRegisteredName) {
    return "?";
  }

  const parts = userName.split(/\s+/).filter(Boolean);
  const first = Array.from(parts[0] ?? "")[0];
  const last = Array.from(parts.at(-1) ?? "")[0];

  return (parts.length > 1 ? `${first ?? ""}${last ?? ""}` : first ?? "?")
    .toLocaleUpperCase("pt-BR");
}

function NavigationLink({
  href,
  label,
  pathname,
  onNavigate,
  children,
  nested = false,
}: {
  href: string;
  label: string;
  pathname: string;
  onNavigate?: () => void;
  children: ReactNode;
  nested?: boolean;
}) {
  const isActive = isCurrentSection(pathname, href);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      onClick={onNavigate}
      className={`nk-focus flex min-h-11 items-center gap-3 rounded-xl text-sm font-black transition ${
        nested ? "px-3 pl-11" : "px-3"
      } ${
        isActive
          ? "bg-brand-gold text-brand-charcoal shadow-sm"
          : "text-slate-200 hover:bg-white/10 hover:text-white"
      }`}
    >
      <span aria-hidden="true" className="flex size-5 shrink-0 items-center">
        {children}
      </span>
      <span>{label}</span>
    </Link>
  );
}

function ComingSoonItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-disabled="true"
      className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold text-slate-400"
    >
      <span aria-hidden="true" className="flex size-5 shrink-0 items-center">
        {children}
      </span>
      <span>{label}</span>
      <span className="ml-auto rounded-full border border-white/15 px-2 py-0.5 text-[0.6rem] font-black tracking-wide uppercase">
        Em breve
      </span>
    </div>
  );
}

function NavigationContent({
  idSuffix,
  pathname,
  userName,
  hasRegisteredName,
  operationsExpanded,
  onToggleOperations,
  onNavigate,
}: NavigationContentProps) {
  const operationsId = `operations-${idSuffix}`;
  const initials = getInitials(userName, hasRegisteredName);
  const isOperationsActive =
    isCurrentSection(pathname, "/entrada") ||
    isCurrentSection(pathname, "/saida");
  const showOperations = operationsExpanded || isOperationsActive;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav
        aria-label="Navegação principal"
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
      >
        <div className="space-y-1">
          <NavigationLink
            href="/"
            label="Assistente IA"
            pathname={pathname}
            onNavigate={onNavigate}
          >
            <AssistantIcon className="size-5" />
          </NavigationLink>

          <ComingSoonItem label="Pedidos">
            <OrdersIcon className="size-5" />
          </ComingSoonItem>

          <NavigationLink
            href="/estoque"
            label="Estoque"
            pathname={pathname}
            onNavigate={onNavigate}
          >
            <StockIcon className="size-5" />
          </NavigationLink>

          <div>
            <button
              type="button"
              aria-expanded={showOperations}
              aria-controls={operationsId}
              onClick={onToggleOperations}
              className={`nk-focus flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-black transition ${
                isOperationsActive
                  ? "bg-white/10 text-brand-gold"
                  : "text-slate-200 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center"
              >
                <InboundIcon className="size-5" />
              </span>
              <span>Entrada e Saída</span>
              <ChevronDownIcon
                className={`ml-auto size-4 transition-transform ${
                  showOperations ? "rotate-180" : ""
                }`}
              />
            </button>

            {showOperations ? (
              <div id={operationsId} className="mt-1 space-y-1">
                <NavigationLink
                  href="/entrada"
                  label="Entrada"
                  pathname={pathname}
                  onNavigate={onNavigate}
                  nested
                >
                  <InboundIcon className="size-4" />
                </NavigationLink>
                <NavigationLink
                  href="/saida"
                  label="Saída"
                  pathname={pathname}
                  onNavigate={onNavigate}
                  nested
                >
                  <OutboundIcon className="size-4" />
                </NavigationLink>
              </div>
            ) : null}
          </div>

          <NavigationLink
            href="/estatisticas"
            label="Estatísticas"
            pathname={pathname}
            onNavigate={onNavigate}
          >
            <StatisticsIcon className="size-5" />
          </NavigationLink>

          <NavigationLink
            href="/historico"
            label="Histórico"
            pathname={pathname}
            onNavigate={onNavigate}
          >
            <ClockIcon className="size-5" />
          </NavigationLink>
        </div>
      </nav>

      <div className="border-t border-white/12 p-3">
        <div className="flex items-center gap-3 rounded-xl bg-white/6 px-3 py-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-gold text-xs font-black text-brand-charcoal"
          >
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black text-white">{userName}</p>
            <Link
              href="/minha-conta"
              onClick={onNavigate}
              className="nk-focus mt-0.5 inline-flex rounded text-xs font-bold text-brand-gold hover:underline"
            >
              Minha conta
            </Link>
          </div>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="nk-focus mt-2 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-black text-red-200 transition hover:bg-red-950/45 hover:text-white"
          >
            <LogoutIcon className="size-5" />
            Sair
          </button>
        </form>
      </div>
    </div>
  );
}

export function AppSidebar({ userName, hasRegisteredName }: AppSidebarProps) {
  const pathname = usePathname();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [operationsExpanded, setOperationsExpanded] = useState(false);
  const drawerTitleId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const closeDrawer = useCallback((restoreFocus = false) => {
    setIsDrawerOpen(false);

    if (restoreFocus) {
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!isDrawerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer(true);
        return;
      }

      if (event.key !== "Tab" || !drawerRef.current) {
        return;
      }

      const focusableElements = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
  }, [closeDrawer, isDrawerOpen]);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-64 flex-col border-r border-brand-gold/20 bg-brand-charcoal pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-white shadow-[14px_0_38px_-30px_rgba(0,0,0,0.8)] lg:flex">
        <Link
          href="/"
          aria-label="Ir para o Assistente IA"
          className="nk-focus mx-4 mt-4 rounded-xl border-b border-white/10 px-2 pb-5"
        >
          <BrandMark variant="full" size="sm" inverted />
        </Link>
        <NavigationContent
          idSuffix="desktop"
          pathname={pathname}
          userName={userName}
          hasRegisteredName={hasRegisteredName}
          operationsExpanded={operationsExpanded}
          onToggleOperations={() =>
            setOperationsExpanded((current) => !current)
          }
        />
      </aside>

      <header className="sticky top-0 z-50 h-14 border-b border-brand-gold/20 bg-brand-charcoal px-3 text-white shadow-sm lg:hidden">
        <div className="flex h-full items-center gap-3">
          <button
            ref={menuButtonRef}
            type="button"
            aria-label="Abrir menu principal"
            aria-haspopup="dialog"
            aria-expanded={isDrawerOpen}
            onClick={() => setIsDrawerOpen(true)}
            className="nk-focus inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/20 text-white transition hover:border-brand-gold hover:bg-white/10"
          >
            <MenuIcon className="size-6" />
          </button>
          <Link
            href="/"
            aria-label="Ir para o Assistente IA"
            className="nk-focus min-w-0 rounded-full"
          >
            <BrandMark variant="full" size="sm" inverted />
          </Link>
        </div>
      </header>

      {isDrawerOpen ? (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDrawer(true);
            }
          }}
          className="fixed inset-0 z-[90] bg-black/65 lg:hidden"
        >
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={drawerTitleId}
            className="flex h-full w-[min(20rem,calc(100vw-2rem))] flex-col border-r border-brand-gold/25 bg-brand-charcoal pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-white shadow-2xl"
          >
            <div className="flex min-h-16 items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
              <div id={drawerTitleId}>
                <BrandMark variant="full" size="sm" inverted />
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Fechar menu principal"
                onClick={() => closeDrawer(true)}
                className="nk-focus inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/20 text-white transition hover:border-brand-gold hover:bg-white/10"
              >
                <CloseIcon className="size-6" />
              </button>
            </div>
            <NavigationContent
              idSuffix="mobile"
              pathname={pathname}
              userName={userName}
              hasRegisteredName={hasRegisteredName}
              operationsExpanded={operationsExpanded}
              onToggleOperations={() =>
                setOperationsExpanded((current) => !current)
              }
              onNavigate={() => closeDrawer()}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
