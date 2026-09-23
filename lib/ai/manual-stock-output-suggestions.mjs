export function planConfigurationOutputSuggestion(target, requestedQuantity) {
  const mounted = target.currentStock;
  const assemblyCapacity = target.autoAssemblyCapacity;
  const maximumPossible = mounted + assemblyCapacity;
  if (requestedQuantity <= mounted) {
    return { kind: "AVAILABLE", maximumPossible };
  }
  if (requestedQuantity <= maximumPossible) {
    return {
      kind: "ASSEMBLY_REQUIRED",
      assemblyQuantity: requestedQuantity - mounted,
      maximumPossible,
    };
  }
  return { kind: "INSUFFICIENT", maximumPossible };
}

export function planLooseServoOutputSuggestion(
  looseQuantity,
  requestedQuantity,
  mountedConfigurations,
) {
  if (requestedQuantity <= looseQuantity) {
    return { kind: "AVAILABLE", maximumPossible: looseQuantity };
  }

  const shortage = requestedQuantity - looseQuantity;
  const mounted = mountedConfigurations.filter(
    (configuration) =>
      Number.isSafeInteger(configuration.currentStock) &&
      configuration.currentStock > 0,
  );
  const recoverableMounted = mounted.reduce(
    (sum, configuration) => sum + configuration.currentStock,
    0,
  );
  const maximumPossible = looseQuantity + recoverableMounted;
  if (maximumPossible < requestedQuantity) {
    return { kind: "INSUFFICIENT", shortage, recoverableMounted, maximumPossible };
  }

  const options = mounted.filter(
    (configuration) => configuration.currentStock >= shortage,
  );
  if (!options.length) {
    let remainingShortage = shortage;
    const steps = mounted
      .map((configuration) => {
        const suggestedQuantity = Math.min(
          configuration.currentStock,
          remainingShortage,
        );
        remainingShortage -= suggestedQuantity;
        return { ...configuration, suggestedQuantity };
      })
      .filter((configuration) => configuration.suggestedQuantity > 0);
    return {
      kind: "MULTIPLE_DISASSEMBLIES_REQUIRED",
      shortage,
      recoverableMounted,
      maximumPossible,
      options: steps,
    };
  }

  return {
    kind: "DISASSEMBLY_OPTIONS",
    shortage,
    recoverableMounted,
    maximumPossible,
    options: options.map((configuration) => ({
      ...configuration,
      suggestedQuantity: shortage,
    })),
  };
}
