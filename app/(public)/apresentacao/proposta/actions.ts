"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  COMMERCIAL_PROPOSAL_COOKIE_NAME,
  commercialProposalCredentialsMatch,
  commercialProposalSessionLifetimeSeconds,
  createCommercialProposalSessionToken,
  getCommercialProposalCredentials,
} from "@/lib/commercial-proposal-auth";

export type CommercialProposalLoginState = { error?: string };

const proposalCookieOptions = {
  httpOnly: true,
  maxAge: commercialProposalSessionLifetimeSeconds,
  path: "/apresentacao/proposta",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

export async function commercialProposalLogin(
  _previousState: CommercialProposalLoginState,
  formData: FormData,
): Promise<CommercialProposalLoginState> {
  const usernameValue = formData.get("username");
  const passwordValue = formData.get("password");
  const username = typeof usernameValue === "string" ? usernameValue.trim() : "";
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const credentials = getCommercialProposalCredentials();

  if (!credentials || !commercialProposalCredentialsMatch(username, password, credentials)) {
    return { error: "Usuário ou senha inválidos." };
  }

  const token = createCommercialProposalSessionToken(credentials.sessionSecret);
  if (!token) return { error: "Usuário ou senha inválidos." };

  const cookieStore = await cookies();
  cookieStore.set(COMMERCIAL_PROPOSAL_COOKIE_NAME, token, proposalCookieOptions);
  redirect("/apresentacao/proposta");
}

export async function commercialProposalLogout() {
  const cookieStore = await cookies();
  cookieStore.set(COMMERCIAL_PROPOSAL_COOKIE_NAME, "", { ...proposalCookieOptions, maxAge: 0 });
  redirect("/apresentacao/proposta");
}
