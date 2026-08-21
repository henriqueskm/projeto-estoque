"use client";

import { useActionState } from "react";
import {
  commercialProposalLogin,
  type CommercialProposalLoginState,
} from "@/app/(public)/apresentacao/proposta/actions";

const initialState: CommercialProposalLoginState = {};

export function CommercialProposalLogin() {
  const [state, formAction, isPending] = useActionState(commercialProposalLogin, initialState);

  return (
    <main className="proposal-login-page">
      <section className="proposal-login-card" aria-labelledby="proposal-login-title">
        <p className="public-eyebrow">NK Estoque</p>
        <h1 id="proposal-login-title">Proposta comercial</h1>
        <p>Entre para acessar uma visão detalhada do sistema e do investimento.</p>
        <form action={formAction} className="proposal-login-form">
          <label htmlFor="proposal-username">Usuário</label>
          <input id="proposal-username" name="username" type="text" autoComplete="username" required disabled={isPending} />
          <label htmlFor="proposal-password">Senha</label>
          <input id="proposal-password" name="password" type="password" autoComplete="current-password" required disabled={isPending} />
          {state.error ? <p className="proposal-login-error" role="alert" aria-live="polite">{state.error}</p> : null}
          <button type="submit" className="public-button" disabled={isPending}>{isPending ? "Acessando..." : "Acessar proposta"}</button>
        </form>
        <a className="proposal-back-link nk-focus" href="/apresentacao">← Voltar para apresentação</a>
      </section>
    </main>
  );
}
