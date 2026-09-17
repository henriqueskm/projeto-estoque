import {
  fetchVehicleApplicationPages,
  type VehicleApplication,
  type VehicleApplicationBrand,
  type VehicleApplicationCategory,
  type VehicleApplicationKind,
  type VehicleApplicationResolutionStatus,
} from "@/lib/vehicle-applications-domain";
import { createClient } from "@/lib/supabase/server";

type BrandRow = {
  id: string;
  slug: string;
  name: string;
  display_order: number;
};

type ApplicationRow = {
  id: string;
  brand_id: string;
  category: VehicleApplicationCategory | null;
  vehicle_model: string;
  application_kind: VehicleApplicationKind;
  source_kit_code: string | null;
  source_servo_label: string | null;
  commercial_configuration_code_id: string | null;
  catalog_resolution_status: VehicleApplicationResolutionStatus;
  observation: string | null;
  source_sheet: string;
  source_row: number;
  sort_order: number;
};

type SourceKitCodeRow = {
  id: string;
  source_kit_code: string;
};

const applicationPageSize = 100;

const brandLogoPaths: Record<string, string> = {
  "mercedes-benz": "/aplicacoes/marcas/mercedes-benz.png",
  ford: "/aplicacoes/marcas/ford.png",
  volkswagen: "/aplicacoes/marcas/volkswagen.png",
  scania: "/aplicacoes/marcas/scania.png",
  volvo: "/aplicacoes/marcas/volvo.png",
  agrale: "/aplicacoes/marcas/agrale.png",
  metalfor: "/aplicacoes/marcas/metalfor.png",
  gmc: "/aplicacoes/marcas/gmc.png",
};

function mapBrand(row: BrandRow): VehicleApplicationBrand {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    displayOrder: row.display_order,
    logoPath: brandLogoPaths[row.slug] ?? "",
  };
}

function mapApplication(row: ApplicationRow): VehicleApplication {
  return {
    id: row.id,
    brandId: row.brand_id,
    category: row.category,
    vehicleModel: row.vehicle_model,
    applicationKind: row.application_kind,
    sourceKitCode: row.source_kit_code,
    sourceServoLabel: row.source_servo_label,
    commercialConfigurationCodeId: row.commercial_configuration_code_id,
    catalogResolutionStatus: row.catalog_resolution_status,
    observation: row.observation,
    sourceSheet: row.source_sheet,
    sourceRow: row.source_row,
    sortOrder: row.sort_order,
  };
}

export async function loadVehicleApplicationBrands(): Promise<{
  data: VehicleApplicationBrand[] | null;
  error: string | null;
}> {
  try {
    const supabase = await createClient();
    const result = await supabase
      .from("vehicle_application_brands")
      .select("id, slug, name, display_order")
      .order("display_order", { ascending: true });

    if (result.error) {
      return {
        data: null,
        error: "Não foi possível carregar as marcas agora.",
      };
    }

    return {
      data: ((result.data ?? []) as BrandRow[]).map(mapBrand),
      error: null,
    };
  } catch {
    return {
      data: null,
      error: "Não foi possível carregar as marcas agora.",
    };
  }
}

export async function loadVehicleApplicationsByBrand(slug: string): Promise<{
  brand: VehicleApplicationBrand | null;
  applications: VehicleApplication[] | null;
  authoritativeSourceKitCodes: string[] | null;
  error: string | null;
}> {
  try {
    const supabase = await createClient();
    const brandResult = await supabase
      .from("vehicle_application_brands")
      .select("id, slug, name, display_order")
      .eq("slug", slug)
      .maybeSingle();

    if (brandResult.error) {
      return {
        brand: null,
        applications: null,
        authoritativeSourceKitCodes: null,
        error: "Não foi possível carregar esta marca agora.",
      };
    }

    if (!brandResult.data) {
      return {
        brand: null,
        applications: null,
        authoritativeSourceKitCodes: null,
        error: null,
      };
    }

    const brand = mapBrand(brandResult.data as BrandRow);
    const [rows, sourceKitCodeRows] = await Promise.all([
      fetchVehicleApplicationPages<ApplicationRow>(async (from, to) => {
        const result = await supabase
          .from("vehicle_applications")
          .select(
            "id, brand_id, category, vehicle_model, application_kind, source_kit_code, source_servo_label, commercial_configuration_code_id, catalog_resolution_status, observation, source_sheet, source_row, sort_order",
          )
          .eq("brand_id", brand.id)
          .order("sort_order", { ascending: true })
          .range(from, to);

        if (result.error) {
          throw result.error;
        }

        return (result.data ?? []) as ApplicationRow[];
      }, applicationPageSize),
      fetchVehicleApplicationPages<SourceKitCodeRow>(async (from, to) => {
        const result = await supabase
          .from("vehicle_applications")
          .select("id, source_kit_code")
          .not("source_kit_code", "is", null)
          .order("source_kit_code", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);

        if (result.error) {
          throw result.error;
        }

        return (result.data ?? []) as SourceKitCodeRow[];
      }, applicationPageSize),
    ]);

    return {
      brand,
      applications: rows.map(mapApplication),
      authoritativeSourceKitCodes: Array.from(
        new Set(sourceKitCodeRows.map((row) => row.source_kit_code)),
      ),
      error: null,
    };
  } catch {
    return {
      brand: null,
      applications: null,
      authoritativeSourceKitCodes: null,
      error: "Não foi possível carregar as aplicações desta marca agora.",
    };
  }
}
