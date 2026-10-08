import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SafisaPortal } from "../components/safisa-portal";
import { beginSafisaLogicalAttempt, markSafisaAttemptResultUnknown, serializeSafisaLogicalAttempt } from "../lib/safisa-logical-attempt";
import { fixtureOrders, fixtureUserId, partialOrder, asSummary } from "./safisa-portal-ui-fixtures";

// Isolated, sanitized presentation harness. No server or Supabase connection.
const params = new URLSearchParams(location.search);
const storageKey = `negocios-k:safisa-logical-attempt:v1:${fixtureUserId}`;
localStorage.removeItem(storageKey);
if (params.get("fixture") === "unknown") {
  localStorage.setItem(storageKey, serializeSafisaLogicalAttempt(markSafisaAttemptResultUnknown(beginSafisaLogicalAttempt(null, {
    kind: "INCREMENT_READY_QUANTITY", supplierOrderId: partialOrder.supplierOrderId,
    supplierOrderItemId: partialOrder.lines[1].supplierOrderItemId, incrementQuantity: 1,
  }, () => "87000000-0000-4000-8000-000000000999"))));
}

function Fixture() {
  const [url, setUrl] = useState(location.href);
  useEffect(() => {
    const changed = () => setUrl(location.href);
    window.addEventListener("popstate", changed);
    window.addEventListener("nk87-fixture-route", changed);
    return () => { window.removeEventListener("popstate", changed); window.removeEventListener("nk87-fixture-route", changed); };
  }, []);
  const id = new URL(url).searchParams.get("pedido");
  return <SafisaPortal userId={fixtureUserId} displayName="Operador local"
    activeOrders={fixtureOrders.filter(order => !order.isReadOnly).map(asSummary)}
    completedOrders={fixtureOrders.filter(order => order.isReadOnly).map(asSummary)}
    selectedOrder={fixtureOrders.find(order => order.supplierOrderId === id) ?? null} />;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
