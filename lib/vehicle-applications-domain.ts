export type VehicleApplicationCategory = "TRUCK" | "BUS" | "MICROBUS";
export type VehicleApplicationKind = "NORMAL" | "RESTRICTION";
export type VehicleApplicationResolutionStatus =
  | "RESOLVED"
  | "UNRESOLVED"
  | "NOT_APPLICABLE";

export type VehicleApplicationBrand = {
  id: string;
  slug: string;
  name: string;
  displayOrder: number;
  logoPath: string;
};

export type VehicleApplication = {
  id: string;
  brandId: string;
  category: VehicleApplicationCategory | null;
  vehicleModel: string;
  applicationKind: VehicleApplicationKind;
  sourceKitCode: string | null;
  sourceServoLabel: string | null;
  commercialConfigurationCodeId: string | null;
  catalogResolutionStatus: VehicleApplicationResolutionStatus;
  observation: string | null;
  sourceSheet: string;
  sourceRow: number;
  sortOrder: number;
};

export type VehicleApplicationGroup = {
  key: string;
  sourceKitCode: string;
  sourceServoLabel: string;
  catalogResolutionStatus: "RESOLVED" | "UNRESOLVED";
  applications: VehicleApplication[];
};

export const vehicleApplicationCategoryLabels: Record<
  VehicleApplicationCategory,
  string
> = {
  TRUCK: "Caminhões",
  BUS: "Ônibus",
  MICROBUS: "Micro-ônibus",
};

export function normalizeVehicleApplicationSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "");
}

export function filterVehicleApplications(
  applications: VehicleApplication[],
  query: string,
  category: VehicleApplicationCategory | "ALL",
) {
  const normalizedQuery = normalizeVehicleApplicationSearch(query);

  return applications.filter((application) => {
    if (category !== "ALL" && application.category !== category) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const searchableText = [
      application.sourceKitCode,
      application.sourceServoLabel,
      application.vehicleModel,
      application.observation,
    ]
      .filter(Boolean)
      .join(" ");

    return normalizeVehicleApplicationSearch(searchableText).includes(
      normalizedQuery,
    );
  });
}

export function groupVehicleApplications(
  applications: VehicleApplication[],
): VehicleApplicationGroup[] {
  const groups = new Map<string, VehicleApplicationGroup>();

  applications.forEach((application) => {
    if (
      application.applicationKind !== "NORMAL" ||
      !application.sourceKitCode ||
      !application.sourceServoLabel ||
      application.catalogResolutionStatus === "NOT_APPLICABLE"
    ) {
      return;
    }

    const key = `${application.sourceKitCode}\u0000${application.sourceServoLabel}`;
    const existing = groups.get(key);

    if (existing) {
      existing.applications.push(application);
      return;
    }

    groups.set(key, {
      key,
      sourceKitCode: application.sourceKitCode,
      sourceServoLabel: application.sourceServoLabel,
      catalogResolutionStatus: application.catalogResolutionStatus,
      applications: [application],
    });
  });

  return Array.from(groups.values());
}

export async function fetchVehicleApplicationPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 100,
) {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    rows.push(...page);

    if (page.length < pageSize) {
      return rows;
    }
  }
}
