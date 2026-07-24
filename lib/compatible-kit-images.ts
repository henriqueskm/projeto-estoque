export type CompatibleKitImageOption = {
  configurationId: string;
  commercialCodes: string[];
  servoCode: string;
  servoDescription: string;
  servoModel: string | null;
  installationKitCode: string;
  description: string;
  imageUrl: string;
};

export type CompatibleKitImageDraft = CompatibleKitImageOption & {
  installationKitId: string;
};

function compareCodes(first: string, second: string) {
  return first.localeCompare(second, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

export function createCompatibleKitImageMap(
  drafts: CompatibleKitImageDraft[],
) {
  const result = new Map<string, CompatibleKitImageOption[]>();
  const configurationIdsByInstallationKitId = new Map<
    string,
    Set<string>
  >();

  const sortedDrafts = [...drafts].sort((first, second) => {
    const firstCode = first.commercialCodes[0] ?? first.description;
    const secondCode = second.commercialCodes[0] ?? second.description;

    return (
      compareCodes(firstCode, secondCode) ||
      first.configurationId.localeCompare(second.configurationId)
    );
  });

  sortedDrafts.forEach(
    ({
      installationKitId,
      commercialCodes,
      ...configuration
    }) => {
      const configurationIds =
        configurationIdsByInstallationKitId.get(installationKitId) ??
        new Set<string>();

      if (configurationIds.has(configuration.configurationId)) {
        return;
      }

      configurationIds.add(configuration.configurationId);
      configurationIdsByInstallationKitId.set(
        installationKitId,
        configurationIds,
      );

      const options = result.get(installationKitId) ?? [];
      options.push({
        ...configuration,
        commercialCodes: Array.from(new Set(commercialCodes)).sort(
          compareCodes,
        ),
      });
      result.set(installationKitId, options);
    },
  );

  return result;
}
