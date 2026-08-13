export type AssistantOperationalConfirmationRoutes = {
  supplierOrderFinalization: boolean;
  configurationDisassembly: boolean;
  configurationAssembly: boolean;
  stockEntry: boolean;
  manualStockOutput: boolean;
  supplierOrderPickup: boolean;
};

const confirmationMessages = {
  supplierOrderFinalization:
    "Use o botão Confirmar finalização na prévia. Nenhum Pedido foi finalizado por esta mensagem.",
  configurationDisassembly:
    "Use o botão de confirmação da prévia. Nenhuma operação foi executada por esta mensagem.",
  configurationAssembly:
    "Use o botão de confirmação da prévia. Nenhuma operação foi executada por esta mensagem.",
  stockEntry:
    "Use o botão Confirmar entrada na prévia. Nenhuma entrada foi executada por esta mensagem.",
  manualStockOutput:
    "Use o botão Confirmar saída na prévia. Nenhuma saída foi executada por esta mensagem.",
  supplierOrderPickup:
    "Use o botão Confirmar retirada na prévia acima. Nenhuma retirada foi executada por esta mensagem.",
} as const;

const routeForPreview: Record<
  string,
  keyof AssistantOperationalConfirmationRoutes
> = {
  supplier_order_finalization_preview: "supplierOrderFinalization",
  configuration_disassembly_preview: "configurationDisassembly",
  configuration_assembly_preview: "configurationAssembly",
  supplier_order_stock_entry_preview: "stockEntry",
  manual_stock_entry_preview: "stockEntry",
  manual_stock_output_preview: "manualStockOutput",
  assistant_action_preview: "supplierOrderPickup",
};

export function hasOperationalConfirmationText(
  routes: AssistantOperationalConfirmationRoutes,
) {
  return Object.values(routes).some(Boolean);
}

export function getOperationalConfirmationGuard(
  lastIntent: string | null,
  routes: AssistantOperationalConfirmationRoutes,
) {
  if (!lastIntent) return null;
  const route = routeForPreview[lastIntent];
  return route && routes[route] ? confirmationMessages[route] : null;
}
