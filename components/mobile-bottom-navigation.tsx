"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClockIcon,
  HomeIcon,
  InboundIcon,
  OutboundIcon,
  StockIcon,
} from "@/components/icons";

const navigationItems = [
  {
    label: "Início",
    href: "/",
    icon: HomeIcon,
  },
  {
    label: "Entrada",
    href: "/entrada",
    icon: InboundIcon,
  },
  {
    label: "Saída",
    href: "/saida",
    icon: OutboundIcon,
  },
  {
    label: "Estoque",
    href: "/estoque",
    icon: StockIcon,
  },
  {
    label: "Histórico",
    href: "/historico",
    icon: ClockIcon,
  },
] as const;

function isCurrentSection(pathname: string, href: string) {
  if (href === "/") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileBottomNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-border-neutral bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_32px_-24px_rgba(23,29,33,0.65)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto grid min-h-16 max-w-xl grid-cols-5 gap-1 px-1.5 py-1">
        {navigationItems.map((item) => {
          const isActive = isCurrentSection(pathname, item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`nk-focus flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[0.68rem] leading-none transition ${
                isActive
                  ? "bg-brand-gold-soft font-black text-brand-charcoal"
                  : "font-bold text-text-muted hover:bg-app-background hover:text-brand-charcoal"
              }`}
            >
              <Icon className="size-5 shrink-0" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
