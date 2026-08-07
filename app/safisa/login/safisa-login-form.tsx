"use client";

import { useActionState } from "react";
import { safisaLogin, type SafisaLoginState } from "@/app/safisa/actions";

const initialState: SafisaLoginState = {};

export function SafisaLoginForm() {
  const [state, formAction, isPending] = useActionState(safisaLogin, initialState);
  return (
    <form action={formAction} className="mt-7 space-y-5" noValidate>
      <div>
        <label htmlFor="safisa-email" className="mb-2 block text-sm font-bold text-slate-800">E-mail</label>
        <input
          id="safisa-email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          required
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={state.fieldErrors?.email ? "safisa-email-error" : undefined}
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition focus:border-blue-700 focus:ring-3 focus:ring-blue-100"
          placeholder="voce@safisa.com.br"
        />
        {state.fieldErrors?.email ? <p id="safisa-email-error" className="mt-2 text-sm font-semibold text-red-700">{state.fieldErrors.email}</p> : null}
      </div>
      <div>
        <label htmlFor="safisa-password" className="mb-2 block text-sm font-bold text-slate-800">Senha</label>
        <input
          id="safisa-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby={state.fieldErrors?.password ? "safisa-password-error" : undefined}
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition focus:border-blue-700 focus:ring-3 focus:ring-blue-100"
          placeholder="Digite sua senha"
        />
        {state.fieldErrors?.password ? <p id="safisa-password-error" className="mt-2 text-sm font-semibold text-red-700">{state.fieldErrors.password}</p> : null}
      </div>
      {state.error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{state.error}</div> : null}
      <button type="submit" disabled={isPending} className="min-h-12 w-full rounded-xl bg-blue-800 px-5 text-base font-black text-white shadow-sm transition hover:bg-blue-900 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-blue-800 disabled:cursor-wait disabled:opacity-60">
        {isPending ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
