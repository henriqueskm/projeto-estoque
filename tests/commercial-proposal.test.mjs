import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  commercialProposalCredentialsMatch,
  commercialProposalSessionLifetimeSeconds,
  createCommercialProposalSessionToken,
  verifyCommercialProposalSessionToken,
} from "../lib/commercial-proposal-auth.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const secret = "p".repeat(48);
const credentials = { username: "cliente-nk", password: "segredo-forte", sessionSecret: secret };
const now = new Date("2026-08-21T12:00:00.000Z");

test("commercial credentials remain server-only and validate both fields", () => {
  assert.equal(commercialProposalCredentialsMatch("cliente-nk", "segredo-forte", credentials), true);
  assert.equal(commercialProposalCredentialsMatch("cliente-nk", "outro", credentials), false);
  assert.equal(commercialProposalCredentialsMatch("outro", "segredo-forte", credentials), false);

  const clientSource = [
    read("app/(public)/apresentacao/proposta/page.tsx"),
    read("components/public-site/commercial-proposal-login.tsx"),
  ].join("\n");
  assert.doesNotMatch(clientSource, /NK_PROPOSAL_(USERNAME|PASSWORD|SESSION_SECRET)|NEXT_PUBLIC_NK_PROPOSAL/);
  const documentation = read("docs/COMMERCIAL_PROPOSAL_ENVIRONMENT.md");
  assert.match(documentation, /NK_PROPOSAL_USERNAME/);
  assert.match(documentation, /NK_PROPOSAL_PASSWORD/);
  assert.match(documentation, /NK_PROPOSAL_SESSION_SECRET/);
  assert.match(documentation, /NEXT_PUBLIC_/);
});

test("commercial proposal sessions are signed, expire and reject tampering", () => {
  const token = createCommercialProposalSessionToken(secret, now);
  assert.ok(token);
  assert.equal(verifyCommercialProposalSessionToken(token, secret, now), true);
  assert.equal(verifyCommercialProposalSessionToken(`${token}x`, secret, now), false);
  assert.equal(
    verifyCommercialProposalSessionToken(token, secret, new Date(now.getTime() + (commercialProposalSessionLifetimeSeconds + 1) * 1_000)),
    false,
  );
});

test("proposal is dynamically guarded while the proxy stays narrowly scoped", () => {
  const page = read("app/(public)/apresentacao/proposta/page.tsx");
  const actions = read("app/(public)/apresentacao/proposta/actions.ts");
  const proxy = read("lib/supabase/proxy.ts");

  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.match(page, /const session = await hasCommercialProposalSession\(\);/);
  assert.match(page, /if \(!session\) return <CommercialProposalLogin \/>;/);
  assert.match(page, /R\$ 6\.000/);
  assert.match(page, /R\$ 220/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(actions, /httpOnly: true/);
  assert.match(actions, /sameSite: "lax"/);
  assert.match(actions, /path: "\/apresentacao\/proposta"/);
  assert.match(actions, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(actions, /maxAge: 0/);
  assert.match(proxy, /const isCommercialProposalRoute = pathname === "\/apresentacao\/proposta"/);
  assert.doesNotMatch(proxy, /pathname\.startsWith\("\/apresentacao"\)/);
});

test("proposal is linked from the public presentation and keeps the agreed commercial terms", () => {
  const presentation = read("app/(public)/apresentacao/page.tsx");
  const page = read("app/(public)/apresentacao/proposta/page.tsx");

  assert.match(presentation, /href="\/apresentacao\/proposta">Acessar proposta/);
  for (const phrase of [
    "50% na contratação",
    "R$ 3.000",
    "R$ 220",
    "Durante a implantação não há mensalidade.",
    "Manutenção mensal do sistema",
    "Banco de dados seguro",
  ]) {
    assert.match(page, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(page, /RPC|RLS|UUID|HMAC|Supabase|idempotency|Server Action|React|Next\.js/);
});
