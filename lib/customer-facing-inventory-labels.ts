export const customerFacingInventoryLabels = {
  completeServoKit: "Servo com kit",
  completeServoKits: "Servos com kit",
  looseServo: "Servo sem kit",
  looseServos: "Servos sem kit",
} as const;

export function formatCompleteServoKitLabel(quantity: number) {
  return quantity === 1
    ? customerFacingInventoryLabels.completeServoKit
    : customerFacingInventoryLabels.completeServoKits;
}

export function formatLooseServoLabel(quantity: number) {
  return quantity === 1
    ? customerFacingInventoryLabels.looseServo
    : customerFacingInventoryLabels.looseServos;
}
