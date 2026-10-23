// LOCAL synthetic session. No auth credentials, Supabase client or real writers.
import { Activity, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantStructuredBlockView } from "../components/assistant-structured-block";
import { SemanticBackProvider } from "../components/semantic-back-provider";
import { photoReviewFixture } from "./fixtures/assistant-photo-review";
import type { AssistantStructuredBlock } from "../lib/assistant-types";
import { parseSupplierOrderPhotoCreatePrepareInput } from "../lib/assistant-supplier-order-photo-create-contract";

const requests: string[] = [], tokens: string[] = [];
let confirms = 0, uncertain = false;
Object.assign(window, { __nk102Evidence: { requests, tokens, get confirmations() { return confirms; } } });
window.fetch = async (input, init) => {
  const path = String(input), body = JSON.parse(String(init?.body ?? "{}"));
  requests.push(path);
  window.dispatchEvent(new Event("nk102-evidence"));
  await new Promise(resolve => setTimeout(resolve, 120));
  if (path.endsWith("/resolve-code")) {
    if (!/^FIX-0[1-6]$/.test(body.code)) return Response.json({ status: "NOT_FOUND" });
    return Response.json({ status: "FOUND", code: body.code, description: `Produto fictício para teste ${Number(body.code.slice(-1))}` });
  }
  if (path.endsWith("/prepare-create")) {
    const parsed = parseSupplierOrderPhotoCreatePrepareInput(body);
    if (!parsed) return Response.json({ error: "Dados inválidos." }, { status: 400 });
    return Response.json({ status: "READY", preparation: {
      ...parsed, lines: parsed.lines.map((line, index) => ({ ...line, kind: "ITEM", targetId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, commercialConfigurationCodeId: null, description: `Produto fictício para teste ${Number(line.code.slice(-1))}` })),
      lineCount: parsed.lines.length, totalQuantity: parsed.lines.reduce((sum, line) => sum + line.quantity, 0),
      proposalToken: "fixture-local.signature", expiresAt: new Date(Date.now() + 600000).toISOString(),
    } });
  }
  if (path.endsWith("/confirm-create")) {
    tokens.push(body.proposalToken);
    if (uncertain) { uncertain = false; window.dispatchEvent(new Event("nk102-evidence")); return Response.json({ error: "Resultado desconhecido. Tente verificar novamente com a mesma confirmação." }, { status: 503 }); }
    confirms = 1; // Simulated idempotent writer: zero remote execution.
    window.dispatchEvent(new Event("nk102-evidence"));
    return Response.json({ block: { kind: "supplier_order_photo_create_result", outcome: "success", title: "Pedido criado — SIMULAÇÃO LOCAL", message: "Somente fixture: nenhum Pedido real foi criado.",
      order: { negotiationNumber: "00900123", status: "PENDING", href: "/pedidos?view=active&order=00000000-0000-4000-8000-000000000001" }, lineCount: 5, totalQuantity: 11, fallbackText: "Resultado fictício local." } });
  }
  throw Error("Network outside the LOCAL photo review fixture");
};

function Fixture() {
  const [block, setBlock] = useState<AssistantStructuredBlock>(photoReviewFixture);
  const [route, setRoute] = useState(window.location.pathname);
  const [, setEvidenceVersion] = useState(0);
  useEffect(() => { const pop = () => setRoute(window.location.pathname); window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop); }, []);
  useEffect(() => { const update = () => setEvidenceVersion(value => value + 1); window.addEventListener("nk102-evidence", update); return () => window.removeEventListener("nk102-evidence", update); }, []);
  useEffect(() => {
    const hideWithActivity = (event: KeyboardEvent) => {
      if (event.key !== "F8") return;
      event.preventDefault(); window.dispatchEvent(new Event("nk:workspace:before-navigation"));
      window.history.pushState({ ...window.history.state }, "", "/estoque"); setRoute("/estoque");
    };
    window.addEventListener("keydown", hideWithActivity);
    return () => window.removeEventListener("keydown", hideWithActivity);
  }, []);
  function navigate(path: string) {
    window.dispatchEvent(new Event("nk:workspace:before-navigation"));
    window.history.pushState({ ...window.history.state }, "", path); setRoute(path);
  }
  function scenario(value: string) {
    window.dispatchEvent(new Event("nk:workspace:before-navigation"));
    const next = photoReviewFixture(); uncertain = value === "transport"; requests.length = 0; tokens.length = 0; confirms = 0;
    if (value === "quantity") { next.lines[4].quantity = null; next.lines[4].blockingReasons.push("QUANTITY_MISSING"); next.totalQuantity = 7; }
    if (value === "code") next.lines[4].blockingReasons.push("CODE_UNCERTAIN", "DESCRIPTION_CONFLICT");
    if (value === "header") { next.negotiationNumber = null; next.orderDate = null; }
    if (value === "multiple") { next.lines[0].blockingReasons.push("VISUAL_REVIEW"); next.lines[0].resolution = "NEEDS_REVIEW"; }
    if (value === "duplicate") { next.state = "DUPLICATE_NEGOTIATION"; next.existingOrder = { negotiationNumber: "00900123", status: "PENDING", href: "/pedidos?order=00000000-0000-4000-8000-000000000001" }; }
    if (value === "unreadable") { next.state = "UNREADABLE"; next.lines = []; next.totalQuantity = 0; }
    if (value === "worst") {
      next.negotiationNumber = "000123456789".repeat(10);
      next.lines[4].displayCode = "CATALOGO-COMPLEMENTO-TECNICO-".repeat(4).slice(0, 120);
      next.lines[4].description = "Descrição técnica sanitizada do produto para verificação humana. ".repeat(8).slice(0, 500);
      next.lines[4].warning = "Anotação manuscrita pode alterar o produto e precisa ser conferida. ".repeat(5).slice(0, 300);
      next.lines[4].quantity = 2147483647; next.totalQuantity = 2147483654;
    }
    setBlock(next);
  }
  return <SemanticBackProvider><main className="mx-auto max-w-2xl px-3 py-4">
    <h1 className="text-xl font-black">NK102 — sessão LOCAL simulada</h1>
    <p className="my-2 text-sm">Dados fictícios. Nenhum acesso ao Supabase, IA ou writer real. F8 testa navegação local com Activity.</p>
    <nav className="mb-4 flex flex-wrap gap-2">
      <button className="min-h-11 border px-3" onClick={() => navigate("/")}>Assistente local</button>
      <button className="min-h-11 border px-3" onClick={() => navigate("/estoque")}>Outra rota local</button>
      <label>Cenário <select className="min-h-11 max-w-full border" onChange={event => scenario(event.target.value)} defaultValue="visual">
        <option value="visual">Visual</option><option value="quantity">Quantidade</option><option value="code">Código incerto</option><option value="header">Cabeçalho</option><option value="multiple">Várias pendências</option><option value="transport">Retry incerto</option><option value="duplicate">Duplicado</option><option value="unreadable">Ilegível</option><option value="worst">Limites do schema</option>
      </select></label>
    </nav>
    <Activity mode={route === "/" ? "visible" : "hidden"}><AssistantStructuredBlockView block={block} onSupplierOrderPhotoUpdate={setBlock}/></Activity>
    {route !== "/" ? <p>Outra rota fictícia. Volte para conferir Activity e o estado útil da prévia.</p> : null}
    <output aria-label="Evidência local" className="mt-4 block break-words text-xs">Resolver: {requests.filter(path => path.endsWith("/resolve-code")).length} · Preparar: {requests.filter(path => path.endsWith("/prepare-create")).length} · Confirmar: {tokens.length} · Tokens distintos: {new Set(tokens).size} · Gravações simuladas: {confirms}</output>
  </main></SemanticBackProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
