import type { ReactNode } from "react";
import { PublicFooter } from "@/components/public-site/public-footer";
import { PublicHeader } from "@/components/public-site/public-header";
import "./public-site.css";

export default function PublicLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="public-site">
      <PublicHeader />
      {children}
      <PublicFooter />
    </div>
  );
}
