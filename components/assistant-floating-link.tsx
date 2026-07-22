"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AssistantIcon } from "@/components/icons";

export function AssistantFloatingLink() {
  const pathname = usePathname();

  if (pathname === "/") {
    return null;
  }

  return (
    <Link
      href="/"
      aria-label="Abrir Assistente IA"
      className="nk-focus fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-[70] inline-flex size-14 items-center justify-center rounded-2xl border border-white/25 bg-gradient-to-br from-violet-700 to-blue-700 text-white shadow-[0_16px_32px_-14px_rgba(76,29,149,0.85)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-12px_rgba(76,29,149,0.9)] active:translate-y-0 lg:right-6 lg:bottom-6"
    >
      <AssistantIcon className="size-7" />
    </Link>
  );
}
