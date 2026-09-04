import { NextResponse } from "next/server";
import {
  isSupplierOrderView,
  searchSupplierOrderIdsWithClient,
} from "@/lib/supplier-orders-data";
import { authenticateSupplierOrdersRequest } from "@/lib/supplier-orders-route-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = performance.now();
  const searchParams = new URL(request.url).searchParams;
  const viewValue = searchParams.get("view") ?? "active";
  const query = searchParams.get("q") ?? "";
  if (!isSupplierOrderView(viewValue) || query.length > 120) {
    return NextResponse.json(
      { error: "Pesquisa inválida." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const auth = await authenticateSupplierOrdersRequest();
  if (!auth.ok) {
    return NextResponse.json(
      { error: "Não autorizado." },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const result = await searchSupplierOrderIdsWithClient(
    viewValue,
    query,
    auth.client,
  );
  if (!result.data) {
    return NextResponse.json(
      { error: result.error },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(result.data, {
    headers: {
      "Cache-Control": "no-store",
      "Server-Timing": `supplier-order-search;dur=${Math.round(performance.now() - startedAt)}`,
    },
  });
}
