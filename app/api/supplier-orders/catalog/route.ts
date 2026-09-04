import { NextResponse } from "next/server";
import { loadSupplierOrderCatalogWithClient } from "@/lib/supplier-orders-data";
import { authenticateSupplierOrdersRequest } from "@/lib/supplier-orders-route-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = performance.now();
  const auth = await authenticateSupplierOrdersRequest();
  if (!auth.ok) {
    return NextResponse.json(
      { error: "Não autorizado." },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const result = await loadSupplierOrderCatalogWithClient(auth.client);
  if (!result.data) {
    return NextResponse.json(
      { error: result.error },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(result.data, {
    headers: {
      "Cache-Control": "no-store",
      "Server-Timing": `supplier-order-catalog;dur=${Math.round(performance.now() - startedAt)}`,
    },
  });
}
