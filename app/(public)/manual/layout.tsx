import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ManualNavigation } from "@/components/public-site/manual-navigation";

export const metadata: Metadata = {
  title: "Manual NK Estoque | Central de ajuda",
  description: "Aprenda a usar Estoque, Pedidos, Assistente NK, movimentações, Estatísticas e Portal Safisa.",
  robots: { index: false, follow: false },
};

export default function ManualLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="manual-site">
      <div className="public-shell manual-breadcrumb"><Link href="/apresentacao">NK Estoque</Link><span>/</span><Link href="/manual">Manual</Link></div>
      <div className="public-shell manual-mobile-navigation"><ManualNavigation compact /></div>
      <div className="public-shell manual-grid">
        <aside className="manual-sidebar"><p>Central de ajuda</p><ManualNavigation /></aside>
        <div className="manual-content">{children}</div>
      </div>
    </main>
  );
}
