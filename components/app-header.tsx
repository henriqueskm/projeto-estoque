import Link from "next/link";
import { AccountMenu } from "@/components/account-menu";
import { BrandMark } from "@/components/brand-mark";

type AppHeaderProps = {
  userName: string;
  userEmail: string;
  hasRegisteredName: boolean;
};

export function AppHeader({
  userName,
  userEmail,
  hasRegisteredName,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-brand-gold/25 bg-brand-charcoal text-white shadow-[0_10px_30px_-24px_rgba(0,0,0,0.9)]">
      <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-2 px-4 py-2 sm:gap-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          aria-label="Ir para o início do Negócios K"
          className="nk-focus min-w-0 rounded-full"
        >
          <div className="sm:hidden">
            <BrandMark variant="compact" size="sm" inverted />
          </div>
          <div className="hidden sm:block">
            <BrandMark variant="full" size="sm" inverted />
          </div>
        </Link>

        <div
          aria-hidden="true"
          className="hidden h-8 w-px shrink-0 bg-brand-gold/55 sm:block"
        />

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          <Link
            href="/"
            className="nk-focus inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 px-3 text-xs font-black text-white transition hover:border-brand-gold/70 hover:bg-white/8 sm:px-4 sm:text-sm"
          >
            Início
          </Link>

          <AccountMenu
            fullName={userName}
            email={userEmail}
            hasRegisteredName={hasRegisteredName}
          />
        </div>
      </div>
    </header>
  );
}
