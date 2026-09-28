type ImageComponent = { item_type: string; is_active: boolean };

// Same visibility used by Estoque: mounted stock remains inspectable even
// after the configuration, its components, or all aliases become inactive.
export function isInventoryConfigurationVisible(
  configurationActive: boolean,
  servo: ImageComponent | undefined,
  kit: ImageComponent | undefined,
  hasActiveAlias: boolean,
  assembledQuantity: number,
) {
  return servo?.item_type === "SERVO" &&
    kit?.item_type === "INSTALLATION_KIT" &&
    (assembledQuantity !== 0 ||
      (configurationActive && servo.is_active && kit.is_active && hasActiveAlias));
}
