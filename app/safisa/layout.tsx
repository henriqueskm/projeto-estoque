import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Portal Safisa",
  description: "Acompanhamento de prontidão dos pedidos Safisa",
};

export default function SafisaLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-slate-100 text-slate-950">{children}</div>;
}
