"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/auth/actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="mt-8 space-y-5" noValidate>
      <div>
        <label
          htmlFor="email"
          className="mb-2 block text-sm font-bold text-text-primary"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          required
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
          className="nk-field min-h-12 w-full rounded-xl border px-4 text-base outline-none transition placeholder:text-text-muted"
          placeholder="voce@empresa.com"
        />
        {state.fieldErrors?.email ? (
          <p id="email-error" className="mt-2 text-sm font-medium text-red-700">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="password"
          className="mb-2 block text-sm font-bold text-text-primary"
        >
          Senha
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby={
            state.fieldErrors?.password ? "password-error" : undefined
          }
          className="nk-field min-h-12 w-full rounded-xl border px-4 text-base outline-none transition placeholder:text-text-muted"
          placeholder="Digite sua senha"
        />
        {state.fieldErrors?.password ? (
          <p
            id="password-error"
            className="mt-2 text-sm font-medium text-red-700"
          >
            {state.fieldErrors.password}
          </p>
        ) : null}
      </div>

      {state.error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          {state.error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="nk-focus inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-xl border border-brand-gold-dark/50 bg-brand-charcoal px-5 text-base font-black text-white shadow-[0_8px_22px_-14px_rgba(23,29,33,0.9)] transition hover:bg-brand-charcoal-soft disabled:cursor-wait disabled:opacity-65"
      >
        {isPending ? (
          <>
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            />
            Entrando...
          </>
        ) : (
          "Entrar"
        )}
      </button>
    </form>
  );
}
