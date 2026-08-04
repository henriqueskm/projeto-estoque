export const ASSISTANT_CONFIGURATION_ASSEMBLY_DESCRIPTION =
  "Montagem confirmada pela Assistente NK.";

export function configurationAssemblyProfileHasName(name: unknown) {
  return typeof name === "string" && Boolean(name.trim());
}

export function calculateConfigurationAssemblyProjection(
  mountedStock: number,
  servoStock: number,
  installationKitStock: number,
  quantity: number,
) {
  const mountedStockAfter = mountedStock + quantity;
  const capacity = Math.min(servoStock, installationKitStock);
  return {
    capacity,
    sufficient: quantity <= capacity && mountedStockAfter <= 2_147_483_647,
    mountedStockAfter,
    servoStockAfter: servoStock - quantity,
    installationKitStockAfter: installationKitStock - quantity,
  };
}
