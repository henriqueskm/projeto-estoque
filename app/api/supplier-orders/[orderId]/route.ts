import { NextResponse } from "next/server";
import {
  isSupplierOrderId,
  isSupplierOrderView,
  loadSupplierOrderDetailWithClient,
} from "@/lib/supplier-orders-data";
import { authenticateSupplierOrdersRequest } from "@/lib/supplier-orders-route-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ orderId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const startedAt = performance.now();
  const { orderId } = await context.params;
  const viewValue = new URL(request.url).searchParams.get("view") ?? "active";

  if (!isSupplierOrderId(orderId) || !isSupplierOrderView(viewValue)) {
    return NextResponse.json(
      { error: "Pedido inválido." },
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

  const result = await loadSupplierOrderDetailWithClient(
    orderId,
    viewValue,
    auth.client,
  );
  if (!result.data) {
    const status = result.error === "Pedido não encontrado." ? 404 : 503;
    return NextResponse.json(
      { error: result.error },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(result.data, {
    headers: {
      "Cache-Control": "no-store",
      "Server-Timing": `supplier-order-detail;dur=${Math.round(performance.now() - startedAt)}`,
    },
  });
}
