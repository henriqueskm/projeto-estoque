import { logout } from "@/app/auth/actions";
import { LogoutIcon } from "@/components/icons";

type AppHeaderProps = {
  userName: string;
};

export function AppHeader({ userName }: AppHeaderProps) {
  return (
    <header className="border-b border-emerald-950/10 bg-white">
      <div className="mx-auto flex min-h-18 w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-sm font-bold text-white shadow-sm">
            NK
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-bold tracking-tight text-slate-950">
              Negócios K
            </p>
            <p className="truncate text-xs text-slate-500">{userName}</p>
          </div>
        </div>

        <form action={logout}>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          >
            <LogoutIcon className="size-4" />
            Sair
          </button>
        </form>
      </div>
    </header>
  );
}
