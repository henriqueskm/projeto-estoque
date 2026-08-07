import type { Metadata } from "next";
import { SafisaLoginForm } from "./safisa-login-form";

export const metadata: Metadata = { title: "Entrar | Portal Safisa" };

type Props = { searchParams: Promise<{ error?: string }> };

export default async function SafisaLoginPage({ searchParams }: Props) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-8 sm:px-6">
      <section className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/8">
        <div className="h-2 bg-blue-800" />
        <div className="p-6 sm:p-9">
          <div className="flex size-13 items-center justify-center rounded-2xl bg-blue-800 text-xl font-black text-white" aria-hidden="true">S</div>
          <p className="mt-6 text-xs font-black tracking-[0.18em] text-blue-800 uppercase">Acesso do fornecedor</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Portal Safisa</h1>
          <p className="mt-3 leading-7 text-slate-600">Acompanhe os pedidos autorizados e informe as unidades que ficaram prontas.</p>
          {error === "unauthorized" ? <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">Este usuário não possui acesso ativo ao Portal Safisa.</div> : null}
          <SafisaLoginForm />
          <p className="mt-7 border-t border-slate-200 pt-5 text-center text-xs leading-5 text-slate-500">Acesso individual e restrito a usuários autorizados.</p>
        </div>
      </section>
    </main>
  );
}
