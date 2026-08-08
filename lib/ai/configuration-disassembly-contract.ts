export const ASSISTANT_CONFIGURATION_DISASSEMBLY_DESCRIPTION =
  "Desmontagem confirmada pela Assistente NK.";

export function configurationDisassemblyProfileHasName(name: unknown) {
  return typeof name === "string" && Boolean(name.trim());
}

export function calculateConfigurationDisassemblyProjection(
  mountedStock: number,
  servoStock: number,
  installationKitStock: number,
  quantity: number,
) {
  const mountedStockAfter = mountedStock - quantity;
  const servoStockAfter = servoStock + quantity;
  const installationKitStockAfter = installationKitStock + quantity;
  return {
    sufficient: quantity <= mountedStock &&
      servoStockAfter <= 2_147_483_647 &&
      installationKitStockAfter <= 2_147_483_647,
    mountedStockAfter,
    servoStockAfter,
    installationKitStockAfter,
  };
}
