-- Generated from aplicacoes_negocios_k_revisado.xlsx.
-- Source SHA-256: EADCF389E83231636A37EC7488345C1552BC4672FF7194F1E5C9A4D6A020D893

begin;

-- The XLSX file hash is verified by scripts/verify_vehicle_applications_source.py.
-- This independent canonical digest protects the payload actually executed here.
create function pg_temp.vehicle_applications_canonical_json(document jsonb)
returns text
language plpgsql
immutable
strict
as $function$
declare
  canonical text;
begin
  case jsonb_typeof(document)
    when 'object' then
      select '{' || coalesce(
        string_agg(
          to_jsonb(entry.key)::text || ':' ||
            pg_temp.vehicle_applications_canonical_json(entry.value),
          ',' order by entry.key
        ),
        ''
      ) || '}'
      into canonical
      from jsonb_each(document) as entry;
    when 'array' then
      select '[' || coalesce(
        string_agg(
          pg_temp.vehicle_applications_canonical_json(entry.value),
          ',' order by entry.position
        ),
        ''
      ) || ']'
      into canonical
      from jsonb_array_elements(document) with ordinality
        as entry(value, position);
    else
      canonical := document::text;
  end case;

  return canonical;
end;
$function$;

create table public.vehicle_application_brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  display_order smallint not null unique,
  constraint vehicle_application_brands_slug_check check (
    slug = btrim(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint vehicle_application_brands_name_check check (
    name = btrim(name) and name <> ''
  ),
  constraint vehicle_application_brands_display_order_check check (
    display_order > 0
  )
);

create table public.vehicle_applications (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null
    references public.vehicle_application_brands (id) on delete restrict,
  category text,
  vehicle_model text not null,
  application_kind text not null,
  source_kit_code text,
  source_servo_label text,
  commercial_configuration_code_id uuid
    references public.commercial_configuration_codes (id) on delete restrict,
  catalog_resolution_status text not null,
  observation text,
  source_sheet text not null,
  source_row integer not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  constraint vehicle_applications_category_check check (
    category is null or category in ('TRUCK', 'BUS', 'MICROBUS')
  ),
  constraint vehicle_applications_vehicle_model_check check (
    vehicle_model = btrim(vehicle_model) and vehicle_model <> ''
  ),
  constraint vehicle_applications_kind_check check (
    application_kind in ('NORMAL', 'RESTRICTION')
  ),
  constraint vehicle_applications_source_kit_code_check check (
    source_kit_code is null
    or (source_kit_code = btrim(source_kit_code) and source_kit_code <> '')
  ),
  constraint vehicle_applications_source_servo_label_check check (
    source_servo_label is null
    or (
      source_servo_label = btrim(source_servo_label)
      and source_servo_label <> ''
    )
  ),
  constraint vehicle_applications_resolution_status_check check (
    catalog_resolution_status in ('RESOLVED', 'UNRESOLVED', 'NOT_APPLICABLE')
  ),
  constraint vehicle_applications_observation_check check (
    observation is null
    or (observation = btrim(observation) and observation <> '')
  ),
  constraint vehicle_applications_source_sheet_check check (
    source_sheet = btrim(source_sheet) and source_sheet <> ''
  ),
  constraint vehicle_applications_source_row_check check (source_row > 0),
  constraint vehicle_applications_sort_order_check check (sort_order > 0),
  constraint vehicle_applications_resolution_consistency_check check (
    (
      application_kind = 'NORMAL'
      and source_kit_code is not null
      and source_servo_label is not null
      and catalog_resolution_status = 'RESOLVED'
      and commercial_configuration_code_id is not null
    )
    or
    (
      application_kind = 'NORMAL'
      and source_kit_code is not null
      and source_servo_label is not null
      and catalog_resolution_status = 'UNRESOLVED'
      and commercial_configuration_code_id is null
    )
    or
    (
      application_kind = 'RESTRICTION'
      and source_kit_code is null
      and source_servo_label is null
      and catalog_resolution_status = 'NOT_APPLICABLE'
      and commercial_configuration_code_id is null
    )
  ),
  constraint vehicle_applications_source_location_key unique (
    source_sheet,
    source_row
  ),
  constraint vehicle_applications_brand_sort_order_key unique (
    brand_id,
    sort_order
  ),
  constraint vehicle_applications_exact_application_key
    unique nulls not distinct (
      brand_id,
      category,
      vehicle_model,
      application_kind,
      source_kit_code,
      source_servo_label,
      catalog_resolution_status,
      observation
    )
);

comment on table public.vehicle_application_brands is
  'Vehicle brands available in the kit application guide.';

comment on table public.vehicle_applications is
  'One authoritative vehicle application per source workbook row. Source SHA-256: EADCF389E83231636A37EC7488345C1552BC4672FF7194F1E5C9A4D6A020D893.';

comment on column public.vehicle_applications.source_servo_label is
  'Authoritative workbook label. Physical catalog data is derived only through commercial_configuration_code_id.';

create index vehicle_applications_brand_id_idx
  on public.vehicle_applications (brand_id, sort_order);

create index vehicle_applications_source_kit_code_idx
  on public.vehicle_applications (source_kit_code)
  where source_kit_code is not null;

create index vehicle_applications_configuration_code_id_idx
  on public.vehicle_applications (commercial_configuration_code_id)
  where commercial_configuration_code_id is not null;

do $$
declare
  v_expected_payload_sha256 constant text :=
    '6e3463c893ce53959ad22ebf9facd309ea8c27f9ac645977e38de02922e7b1eb';
  v_payload constant jsonb := $vehicle_applications${"source_sha256":"EADCF389E83231636A37EC7488345C1552BC4672FF7194F1E5C9A4D6A020D893","brands":[{"slug":"mercedes-benz","name":"Mercedes-Benz","display_order":1},{"slug":"ford","name":"Ford","display_order":2},{"slug":"volkswagen","name":"Volkswagen","display_order":3},{"slug":"scania","name":"Scania","display_order":4},{"slug":"volvo","name":"Volvo","display_order":5},{"slug":"agrale","name":"Agrale","display_order":6},{"slug":"metalfor","name":"Metalfor","display_order":7},{"slug":"gmc","name":"GMC","display_order":8}],"applications":[{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"608","application_kind":"NORMAL","source_kit_code":"2A","source_servo_label":"MBF-025","catalog_resolution_status":"RESOLVED","observation":"TEM QUE SER HIDRAULICO","source_sheet":"MERCEDES-BENZ","source_row":6,"sort_order":1},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"610","application_kind":"NORMAL","source_kit_code":"9A","source_servo_label":"MBF-032","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"MERCEDES-BENZ","source_row":7,"sort_order":2},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"708","application_kind":"NORMAL","source_kit_code":"9A","source_servo_label":"MBF-032","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"MERCEDES-BENZ","source_row":8,"sort_order":3},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"708 E","application_kind":"NORMAL","source_kit_code":"2A","source_servo_label":"MBF-025","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"MERCEDES-BENZ","source_row":9,"sort_order":4},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"709","application_kind":"NORMAL","source_kit_code":"9A","source_servo_label":"MBF-032","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"MERCEDES-BENZ","source_row":10,"sort_order":5},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"710 e 710 Plus","application_kind":"NORMAL","source_kit_code":"9A","source_servo_label":"MBF-032","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"MERCEDES-BENZ","source_row":11,"sort_order":6},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"712 / 712 C / 714","application_kind":"NORMAL","source_kit_code":"9C","source_servo_label":"MBF-032 ELETRÔNICO","catalog_resolution_status":"RESOLVED","observation":"vai com a válvula invertida","source_sheet":"MERCEDES-BENZ","source_row":12,"sort_order":7},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"715 Accelo","application_kind":"NORMAL","source_kit_code":"9C","source_servo_label":"MBF-032 ELETRÔNICO","catalog_resolution_status":"RESOLVED","observation":"vai com a válvula invertida","source_sheet":"MERCEDES-BENZ","source_row":13,"sort_order":8},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"814","application_kind":"NORMAL","source_kit_code":"9A","source_servo_label":"MBF-032","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"MERCEDES-BENZ","source_row":14,"sort_order":9},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"815 Accelo","application_kind":"NORMAL","source_kit_code":"11C","source_servo_label":"AL-10","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"MERCEDES-BENZ","source_row":15,"sort_order":10},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"912","application_kind":"NORMAL","source_kit_code":"9D","source_servo_label":"MBF-032","catalog_resolution_status":"RESOLVED","observation":"vai com a válvula invertida","source_sheet":"MERCEDES-BENZ","source_row":16,"sort_order":11},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"912","application_kind":"NORMAL","source_kit_code":"9C","source_servo_label":"MBF-032 ELETRÔNICO","catalog_resolution_status":"RESOLVED","observation":"vai com a válvula invertida","source_sheet":"MERCEDES-BENZ","source_row":17,"sort_order":12},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"914","application_kind":"NORMAL","source_kit_code":"9D","source_servo_label":"MBF-032","catalog_resolution_status":"RESOLVED","observation":"vai com a válvula invertida","source_sheet":"MERCEDES-BENZ","source_row":18,"sort_order":13},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"914 / 914C","application_kind":"NORMAL","source_kit_code":"9C","source_servo_label":"MBF-032 ELETRÔNICO","catalog_resolution_status":"RESOLVED","observation":"vai com a válvula invertida","source_sheet":"MERCEDES-BENZ","source_row":19,"sort_order":14},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"915 Accelo","application_kind":"NORMAL","source_kit_code":"9C","source_servo_label":"MBF-032 ELETRÔNICO","catalog_resolution_status":"RESOLVED","observation":"vai com a válvula invertida","source_sheet":"MERCEDES-BENZ","source_row":20,"sort_order":15},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"915 Accelo","application_kind":"NORMAL","source_kit_code":"2F","source_servo_label":"MBF-025 ELETR.","catalog_resolution_status":"RESOLVED","observation":"c/ cx. pequena e separada da cx. cambio eaton","source_sheet":"MERCEDES-BENZ","source_row":21,"sort_order":16},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1016","application_kind":"NORMAL","source_kit_code":"11A","source_servo_label":"AL-10","catalog_resolution_status":"RESOLVED","observation":"COM 4 FUROS DE FIXAÇÃO","source_sheet":"MERCEDES-BENZ","source_row":22,"sort_order":17},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1113","application_kind":"NORMAL","source_kit_code":"1H","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"MECÂNICO","source_sheet":"MERCEDES-BENZ","source_row":23,"sort_order":18},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1114","application_kind":"NORMAL","source_kit_code":"1H","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"MECÂNICO CAMINHÃO GRANDE","source_sheet":"MERCEDES-BENZ","source_row":24,"sort_order":19},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1114","application_kind":"NORMAL","source_kit_code":"9D","source_servo_label":"MBF-032","catalog_resolution_status":"RESOLVED","observation":"CABINE IGUAL AO 914 – PEQUENO (válvula invertida)","source_sheet":"MERCEDES-BENZ","source_row":25,"sort_order":20},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1117 / 1118","application_kind":"NORMAL","source_kit_code":"1E","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA REDONDA","source_sheet":"MERCEDES-BENZ","source_row":26,"sort_order":21},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1214 R","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"CARA BICUDA ANO 1990 CIL AUX C/ 04 FUROS","source_sheet":"MERCEDES-BENZ","source_row":27,"sort_order":22},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1214","application_kind":"NORMAL","source_kit_code":"1B","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA BICUDA","source_sheet":"MERCEDES-BENZ","source_row":28,"sort_order":23},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1214","application_kind":"NORMAL","source_kit_code":"1F","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA CHATA","source_sheet":"MERCEDES-BENZ","source_row":29,"sort_order":24},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1214 C","application_kind":"NORMAL","source_kit_code":"2D","source_servo_label":"MBF-025","catalog_resolution_status":"RESOLVED","observation":"CARA CHATA FIXAÇÃO NA CX SECA EMBAIXO","source_sheet":"MERCEDES-BENZ","source_row":30,"sort_order":25},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1215 C Eletrônico","application_kind":"NORMAL","source_kit_code":"9C","source_servo_label":"MBF-032","catalog_resolution_status":"RESOLVED","observation":"2 FUROS – COM CAIXA DE CAMBIO ZF 05 MARCHAS","source_sheet":"MERCEDES-BENZ","source_row":31,"sort_order":26},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1215 C Eletrônico","application_kind":"NORMAL","source_kit_code":"7N","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS – COM CAIXA DE CÂMBIO MBB – ALUMINIO","source_sheet":"MERCEDES-BENZ","source_row":32,"sort_order":27},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1215","application_kind":"NORMAL","source_kit_code":"7A","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"C/ 6 MARCHAS","source_sheet":"MERCEDES-BENZ","source_row":33,"sort_order":28},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1218 EL","application_kind":"NORMAL","source_kit_code":"7N","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS – COM CAIXA DE CÂMBIO MBB – ALUMINIO","source_sheet":"MERCEDES-BENZ","source_row":34,"sort_order":29},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1218","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":35,"sort_order":30},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1218","application_kind":"NORMAL","source_kit_code":"1B","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA BICUDA","source_sheet":"MERCEDES-BENZ","source_row":36,"sort_order":31},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1218 R","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":37,"sort_order":32},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1218","application_kind":"NORMAL","source_kit_code":"1F","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA CHATA","source_sheet":"MERCEDES-BENZ","source_row":38,"sort_order":33},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1313","application_kind":"NORMAL","source_kit_code":"1H","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"MECÂNICO","source_sheet":"MERCEDES-BENZ","source_row":39,"sort_order":34},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1315","application_kind":"NORMAL","source_kit_code":"1E","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA REDONDA","source_sheet":"MERCEDES-BENZ","source_row":40,"sort_order":35},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1315 Atego","application_kind":"NORMAL","source_kit_code":"7A","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS – COM CAIXA DE CÂMBIO MBB – ALUMINIO","source_sheet":"MERCEDES-BENZ","source_row":41,"sort_order":36},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1317 / 1318","application_kind":"NORMAL","source_kit_code":"1E","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA REDONDA","source_sheet":"MERCEDES-BENZ","source_row":42,"sort_order":37},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1318 Atego","application_kind":"NORMAL","source_kit_code":"7A","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS – COM CAIXA DE CÂMBIO MBB – ALUMINIO","source_sheet":"MERCEDES-BENZ","source_row":43,"sort_order":38},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1318 Eletronico","application_kind":"NORMAL","source_kit_code":"7A","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS – COM CAIXA DE CÂMBIO EATON ANO 2006","source_sheet":"MERCEDES-BENZ","source_row":44,"sort_order":39},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1319","application_kind":"NORMAL","source_kit_code":"2B","source_servo_label":"MBF-025","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"MERCEDES-BENZ","source_row":45,"sort_order":40},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1414","application_kind":"NORMAL","source_kit_code":"1B","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA BICUDA","source_sheet":"MERCEDES-BENZ","source_row":46,"sort_order":41},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1414","application_kind":"NORMAL","source_kit_code":"1F","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA CHATA","source_sheet":"MERCEDES-BENZ","source_row":47,"sort_order":42},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1418","application_kind":"NORMAL","source_kit_code":"1F","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA CHATA","source_sheet":"MERCEDES-BENZ","source_row":48,"sort_order":43},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1418","application_kind":"NORMAL","source_kit_code":"1B","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA BICUDA","source_sheet":"MERCEDES-BENZ","source_row":49,"sort_order":44},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"L1418","application_kind":"NORMAL","source_kit_code":"5M","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"CARA BICUDA FIXAÇÃO NA CAIXA SECA ANO 99","source_sheet":"MERCEDES-BENZ","source_row":50,"sort_order":45},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1418 Atego","application_kind":"NORMAL","source_kit_code":"7A","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS – COM CAIXA DE CÂMBIO MBB – ALUMINIO","source_sheet":"MERCEDES-BENZ","source_row":51,"sort_order":46},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1418 Eletrônico","application_kind":"NORMAL","source_kit_code":"7Y","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"C/ FURAÇÃO ESPECIAL (MONTADO INVERTIDO)","source_sheet":"MERCEDES-BENZ","source_row":52,"sort_order":47},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1418 R","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":53,"sort_order":48},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1420","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":54,"sort_order":49},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1513","application_kind":"NORMAL","source_kit_code":"1H","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"MECÂNICO","source_sheet":"MERCEDES-BENZ","source_row":55,"sort_order":50},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1516","application_kind":"NORMAL","source_kit_code":"1H","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"MECÂNICO","source_sheet":"MERCEDES-BENZ","source_row":56,"sort_order":51},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1517","application_kind":"NORMAL","source_kit_code":"1B","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA BICUDA","source_sheet":"MERCEDES-BENZ","source_row":57,"sort_order":52},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1517 / 1518","application_kind":"NORMAL","source_kit_code":"1E","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA REDONDA","source_sheet":"MERCEDES-BENZ","source_row":58,"sort_order":53},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1518 Atego","application_kind":"NORMAL","source_kit_code":"7A","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS – COM CAIXA DE CÂMBIO MBB – ALUMINIO","source_sheet":"MERCEDES-BENZ","source_row":59,"sort_order":54},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1519","application_kind":"NORMAL","source_kit_code":"1H","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA REDONDA – MECANICO","source_sheet":"MERCEDES-BENZ","source_row":60,"sort_order":55},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1519","application_kind":"NORMAL","source_kit_code":"1E","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA REDONDA – HIDRAULICO","source_sheet":"MERCEDES-BENZ","source_row":61,"sort_order":56},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1525","application_kind":"NORMAL","source_kit_code":"3C","source_servo_label":"CJ-015","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"MERCEDES-BENZ","source_row":62,"sort_order":57},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1614","application_kind":"NORMAL","source_kit_code":"1B","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA BICUDA","source_sheet":"MERCEDES-BENZ","source_row":63,"sort_order":58},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1618","application_kind":"NORMAL","source_kit_code":"1B","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA BICUDA","source_sheet":"MERCEDES-BENZ","source_row":64,"sort_order":59},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1618","application_kind":"NORMAL","source_kit_code":"2E","source_servo_label":"MBF-025","catalog_resolution_status":"RESOLVED","observation":"FIXAÇÃO NA PARTE DE BAIXO DA CAIXA SECA","source_sheet":"MERCEDES-BENZ","source_row":65,"sort_order":60},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1618","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR015","catalog_resolution_status":"RESOLVED","observation":"FIXAÇÃO NA PARTE DE CIMA E NO MEIO DA CX SECA","source_sheet":"MERCEDES-BENZ","source_row":66,"sort_order":61},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1620 até 2003","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":67,"sort_order":62},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1620","application_kind":"NORMAL","source_kit_code":"4F","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"CAMBIO EATON","source_sheet":"MERCEDES-BENZ","source_row":68,"sort_order":63},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1620","application_kind":"NORMAL","source_kit_code":"7N","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS - CAIXA DE CÂMBIO MBB – ALUMINIO / ATUADOR","source_sheet":"MERCEDES-BENZ","source_row":69,"sort_order":64},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1620 Classic","application_kind":"NORMAL","source_kit_code":"7Q","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS - CAIXA DE CÂMBIO MBB – ALUMINIO / CILINDRO","source_sheet":"MERCEDES-BENZ","source_row":70,"sort_order":65},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1621","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO","source_sheet":"MERCEDES-BENZ","source_row":71,"sort_order":66},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1621","application_kind":"NORMAL","source_kit_code":"4F","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO e CAMBIO EATON","source_sheet":"MERCEDES-BENZ","source_row":72,"sort_order":67},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1622 Eletrônico","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO e CAMBIO ZF","source_sheet":"MERCEDES-BENZ","source_row":73,"sort_order":68},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1622 Eletrônico","application_kind":"NORMAL","source_kit_code":"4F","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO e CAMBIO EATON","source_sheet":"MERCEDES-BENZ","source_row":74,"sort_order":69},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1625","application_kind":"NORMAL","source_kit_code":"3C","source_servo_label":"CJ-015","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"MERCEDES-BENZ","source_row":75,"sort_order":70},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1625","application_kind":"NORMAL","source_kit_code":"4C","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"MERCEDES-BENZ","source_row":76,"sort_order":71},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1630","application_kind":"NORMAL","source_kit_code":"7E","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO SERVO ORIGINAL","source_sheet":"MERCEDES-BENZ","source_row":77,"sort_order":72},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1714","application_kind":"NORMAL","source_kit_code":"1F","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA CHATA","source_sheet":"MERCEDES-BENZ","source_row":78,"sort_order":73},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1718","application_kind":"NORMAL","source_kit_code":"1F","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA CHATA","source_sheet":"MERCEDES-BENZ","source_row":79,"sort_order":74},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1718 K / Atego","application_kind":"NORMAL","source_kit_code":"7A","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS – CAIXA DE CÂMBIO MBB – ALUMINIO","source_sheet":"MERCEDES-BENZ","source_row":80,"sort_order":75},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1718 K","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":81,"sort_order":76},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1718 M","application_kind":"NORMAL","source_kit_code":"7P","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIX. DO CILINDRO AUXILIAR CAMBIO ZF","source_sheet":"MERCEDES-BENZ","source_row":82,"sort_order":77},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1720","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIX. DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":83,"sort_order":78},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1721","application_kind":"NORMAL","source_kit_code":"7P","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIX. DO SERVO ORIGINAL","source_sheet":"MERCEDES-BENZ","source_row":84,"sort_order":79},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1721","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIX. DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":85,"sort_order":80},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1722","application_kind":"NORMAL","source_kit_code":"7P","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIX. DO SERVO ORIGINAL","source_sheet":"MERCEDES-BENZ","source_row":86,"sort_order":81},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1723","application_kind":"NORMAL","source_kit_code":"7E","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIX. DO SERVO ORIGINAL","source_sheet":"MERCEDES-BENZ","source_row":87,"sort_order":82},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1723M Atego","application_kind":"NORMAL","source_kit_code":"7A","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS – CAIXA DE CÂMBIO MBB – ALUMINIO","source_sheet":"MERCEDES-BENZ","source_row":88,"sort_order":83},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1725 Atego","application_kind":"NORMAL","source_kit_code":"7A","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS – CAIXA DE CÂMBIO MBB – ALUMINIO / HALDEX","source_sheet":"MERCEDES-BENZ","source_row":89,"sort_order":84},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1932","application_kind":"NORMAL","source_kit_code":"7E","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIX. DO SERVO ORIGINAL","source_sheet":"MERCEDES-BENZ","source_row":90,"sort_order":85},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1934","application_kind":"NORMAL","source_kit_code":"7D","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIX. DO SERVO ORIGINAL","source_sheet":"MERCEDES-BENZ","source_row":91,"sort_order":86},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"1935/1938/1941","application_kind":"NORMAL","source_kit_code":"7E","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIX. DO SERVO ORIGINAL","source_sheet":"MERCEDES-BENZ","source_row":92,"sort_order":87},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2013 / 2014","application_kind":"NORMAL","source_kit_code":"1H","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"MECÂNICO","source_sheet":"MERCEDES-BENZ","source_row":93,"sort_order":88},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2215 / 2216 / 2217","application_kind":"NORMAL","source_kit_code":"1H","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"MECÂNICO","source_sheet":"MERCEDES-BENZ","source_row":94,"sort_order":89},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2318","application_kind":"NORMAL","source_kit_code":"1B","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA BICUDA","source_sheet":"MERCEDES-BENZ","source_row":95,"sort_order":90},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2325","application_kind":"NORMAL","source_kit_code":"7E","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIX. DO SERVO ORIGINAL","source_sheet":"MERCEDES-BENZ","source_row":96,"sort_order":91},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2325","application_kind":"NORMAL","source_kit_code":"4C","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIX. DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":97,"sort_order":92},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2325","application_kind":"NORMAL","source_kit_code":"3C","source_servo_label":"CJ-015","catalog_resolution_status":"RESOLVED","observation":"2 FUROS DE FIX. DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":98,"sort_order":93},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2414","application_kind":"NORMAL","source_kit_code":"1B","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA BICUDA","source_sheet":"MERCEDES-BENZ","source_row":99,"sort_order":94},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2418","application_kind":"NORMAL","source_kit_code":"1F","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"CARA CHATA","source_sheet":"MERCEDES-BENZ","source_row":100,"sort_order":95},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2324 LK Eletrônico","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIX. DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":101,"sort_order":96},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2423 B Eletronico","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIX. DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":102,"sort_order":97},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2423 K","application_kind":"NORMAL","source_kit_code":"4E","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIX. DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":103,"sort_order":98},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2423 Câmbio ZF","application_kind":"RESTRICTION","source_kit_code":null,"source_servo_label":null,"catalog_resolution_status":"NOT_APPLICABLE","observation":"NÃO DÁ INSTALAÇÃO","source_sheet":"MERCEDES-BENZ","source_row":104,"sort_order":99},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2425 Atego","application_kind":"NORMAL","source_kit_code":"7A","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS – CAIXA DE CÂMBIO MBB – ALUMINIO","source_sheet":"MERCEDES-BENZ","source_row":105,"sort_order":100},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2428 c/ cil. ferro","application_kind":"NORMAL","source_kit_code":"5D","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"CARA CHATA CX CAMBIO G221/9 ATUADOR HIDR.","source_sheet":"MERCEDES-BENZ","source_row":106,"sort_order":101},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2428 c/ cil. Plastico","application_kind":"NORMAL","source_kit_code":"7A","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS – CX CAMBIO G85 / 6 MARCHAS","source_sheet":"MERCEDES-BENZ","source_row":107,"sort_order":102},{"brand_slug":"mercedes-benz","category":"TRUCK","vehicle_model":"2635","application_kind":"NORMAL","source_kit_code":"7E","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO SERVO ORIGINAL","source_sheet":"MERCEDES-BENZ","source_row":108,"sort_order":103},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"O355 / O364","application_kind":"NORMAL","source_kit_code":"5L","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"FIXAÇÃO NA CAIXA SECA","source_sheet":"MERCEDES-BENZ","source_row":113,"sort_order":104},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"O370","application_kind":"NORMAL","source_kit_code":"3A","source_servo_label":"CJ-015","catalog_resolution_status":"RESOLVED","observation":"2 FUROS DE FIXAÇÃO DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":114,"sort_order":105},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"O370","application_kind":"NORMAL","source_kit_code":"4B","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":115,"sort_order":106},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"O371R – RS – RSD","application_kind":"NORMAL","source_kit_code":"3A","source_servo_label":"CJ-015","catalog_resolution_status":"RESOLVED","observation":"2 FUROS DE FIXAÇÃO DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":116,"sort_order":107},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"O371R – RS – RSD","application_kind":"NORMAL","source_kit_code":"4B","source_servo_label":"BR-015","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO CILINDRO AUXILIAR","source_sheet":"MERCEDES-BENZ","source_row":117,"sort_order":108},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"O371 U","application_kind":"NORMAL","source_kit_code":"1A","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"ABAIXO 93","source_sheet":"MERCEDES-BENZ","source_row":118,"sort_order":109},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"O371 U","application_kind":"NORMAL","source_kit_code":"5J","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"FIXAÇÃO NA CAIXA SECA (ACIMA 93)","source_sheet":"MERCEDES-BENZ","source_row":119,"sort_order":110},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"O371 UP","application_kind":"NORMAL","source_kit_code":"7C","source_servo_label":"BR-040","catalog_resolution_status":"UNRESOLVED","observation":"4 FUROS DE FIXAÇÃO DO SERVO ORIGINAL","source_sheet":"MERCEDES-BENZ","source_row":120,"sort_order":111},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"O371 UP","application_kind":"NORMAL","source_kit_code":"5J","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"2 FUROS DE FIXAÇÃO","source_sheet":"MERCEDES-BENZ","source_row":121,"sort_order":112},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"O400","application_kind":"NORMAL","source_kit_code":"7B","source_servo_label":"BR-040","catalog_resolution_status":"UNRESOLVED","observation":"4 FUROS DE FIXAÇÃO DO SERVO ORIGINAL","source_sheet":"MERCEDES-BENZ","source_row":122,"sort_order":113},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"O500","application_kind":"NORMAL","source_kit_code":"7P","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"C/ FURAÇÃO ESPECIAL (MONTADO INVERTIDO)","source_sheet":"MERCEDES-BENZ","source_row":123,"sort_order":114},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"1315 / 1318","application_kind":"NORMAL","source_kit_code":"1B","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"ABAIXO DE 95","source_sheet":"MERCEDES-BENZ","source_row":124,"sort_order":115},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"1318","application_kind":"NORMAL","source_kit_code":"1C","source_servo_label":"MBF-015","catalog_resolution_status":"RESOLVED","observation":"ABAIXO DE 95 ARGENTINO","source_sheet":"MERCEDES-BENZ","source_row":125,"sort_order":116},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"1318","application_kind":"NORMAL","source_kit_code":"3B","source_servo_label":"CJ-015","catalog_resolution_status":"RESOLVED","observation":"TURBINADO","source_sheet":"MERCEDES-BENZ","source_row":126,"sort_order":117},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"1318","application_kind":"NORMAL","source_kit_code":"2B","source_servo_label":"MBF-025","catalog_resolution_status":"RESOLVED","observation":"MODELO ARGENTINO ACIMA 95","source_sheet":"MERCEDES-BENZ","source_row":127,"sort_order":118},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"1417 / 1418 Eletrônico","application_kind":"NORMAL","source_kit_code":"7Y","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"C/ FURAÇÃO ESPECIAL (MONTADO INVERTIDO)","source_sheet":"MERCEDES-BENZ","source_row":128,"sort_order":119},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"1520 / 1525","application_kind":"NORMAL","source_kit_code":"3A","source_servo_label":"CJ-015","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"MERCEDES-BENZ","source_row":129,"sort_order":120},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"1618","application_kind":"NORMAL","source_kit_code":"2B","source_servo_label":"MBF-025","catalog_resolution_status":"RESOLVED","observation":"MODELO ARGENTINO","source_sheet":"MERCEDES-BENZ","source_row":130,"sort_order":121},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"1620","application_kind":"NORMAL","source_kit_code":"7E","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO SERVO ORIGINAL","source_sheet":"MERCEDES-BENZ","source_row":131,"sort_order":122},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"1721","application_kind":"NORMAL","source_kit_code":"7E","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO SERVO ORIGINAL","source_sheet":"MERCEDES-BENZ","source_row":132,"sort_order":123},{"brand_slug":"mercedes-benz","category":"BUS","vehicle_model":"1721 / 1722","application_kind":"NORMAL","source_kit_code":"7P","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"C/ FURAÇÃO ESPECIAL (MONTADO INVERTIDO)","source_sheet":"MERCEDES-BENZ","source_row":133,"sort_order":124},{"brand_slug":"mercedes-benz","category":"MICROBUS","vehicle_model":"LO 610","application_kind":"NORMAL","source_kit_code":"9A","source_servo_label":"MBF-032","catalog_resolution_status":"RESOLVED","observation":"que tenha compressor de ar","source_sheet":"MERCEDES-BENZ","source_row":138,"sort_order":125},{"brand_slug":"mercedes-benz","category":"MICROBUS","vehicle_model":"812 / 814 / 912 / 914","application_kind":"NORMAL","source_kit_code":"9A","source_servo_label":"MBF-032","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"MERCEDES-BENZ","source_row":139,"sort_order":126},{"brand_slug":"mercedes-benz","category":"MICROBUS","vehicle_model":"LO 914 / LO 915","application_kind":"NORMAL","source_kit_code":"9B","source_servo_label":"MBF-032 ELETRÔNICO","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"MERCEDES-BENZ","source_row":140,"sort_order":127},{"brand_slug":"mercedes-benz","category":"MICROBUS","vehicle_model":"LO 914 / LO 915","application_kind":"NORMAL","source_kit_code":"7AB","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"COM 4 FUROS 2011 CX CAMBIO FERRO FUNDIDO","source_sheet":"MERCEDES-BENZ","source_row":141,"sort_order":128},{"brand_slug":"mercedes-benz","category":"MICROBUS","vehicle_model":"LO 915","application_kind":"NORMAL","source_kit_code":"7R","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"2009 / 2010","source_sheet":"MERCEDES-BENZ","source_row":142,"sort_order":129},{"brand_slug":"mercedes-benz","category":"MICROBUS","vehicle_model":"LO 916","application_kind":"NORMAL","source_kit_code":"11D","source_servo_label":"AL-10","catalog_resolution_status":"RESOLVED","observation":"Euro 5 – com cilindro 4 furos","source_sheet":"MERCEDES-BENZ","source_row":143,"sort_order":130},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"C-712","application_kind":"NORMAL","source_kit_code":"10E","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":6,"sort_order":1},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"712","application_kind":"NORMAL","source_kit_code":"10A","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"ANO 2008 / 2009 / 2010","source_sheet":"FORD","source_row":7,"sort_order":2},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"814 / 815","application_kind":"NORMAL","source_kit_code":"10A","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"MOTOR MWM","source_sheet":"FORD","source_row":8,"sort_order":3},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"814 / 815","application_kind":"NORMAL","source_kit_code":"10C","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"MOTOR CUMMINS","source_sheet":"FORD","source_row":9,"sort_order":4},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"C-815e","application_kind":"NORMAL","source_kit_code":"10A","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"ATÉ JANEIRO DE 2005","source_sheet":"FORD","source_row":10,"sort_order":5},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"C-815e","application_kind":"NORMAL","source_kit_code":"10E","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"ACIMA DE FEVEREIRO DE 2005","source_sheet":"FORD","source_row":11,"sort_order":6},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"816 / 916 / 1119","application_kind":"NORMAL","source_kit_code":"12A","source_servo_label":"SAF-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO (substitui o cilindro)","source_sheet":"FORD","source_row":12,"sort_order":7},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1215 / 1217","application_kind":"NORMAL","source_kit_code":"6A","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"MOTOR CUMMINS OU MWM","source_sheet":"FORD","source_row":13,"sort_order":8},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1313","application_kind":"NORMAL","source_kit_code":"6A","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"FORD CARGO AC DE 85 CX CAMBIO EATON CL-450","source_sheet":"FORD","source_row":14,"sort_order":9},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1314","application_kind":"NORMAL","source_kit_code":"6A","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"MOTOR FORD","source_sheet":"FORD","source_row":15,"sort_order":10},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1315","application_kind":"NORMAL","source_kit_code":"7AC","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"2010 – 2011 – COM 4 FUROS FIXAÇÃO","source_sheet":"FORD","source_row":16,"sort_order":11},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1317","application_kind":"NORMAL","source_kit_code":"6A","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"MOTOR CUMMINS OU MWM","source_sheet":"FORD","source_row":17,"sort_order":12},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1317 Eletronico","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":18,"sort_order":13},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1317","application_kind":"NORMAL","source_kit_code":"7AC","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"2011 – COM CABINE EURO 5","source_sheet":"FORD","source_row":19,"sort_order":14},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1319","application_kind":"NORMAL","source_kit_code":"7AC","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":20,"sort_order":15},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1415","application_kind":"NORMAL","source_kit_code":"6H","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"MOTOR CUMMINS OU MWM","source_sheet":"FORD","source_row":21,"sort_order":16},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1417","application_kind":"NORMAL","source_kit_code":"6A","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":22,"sort_order":17},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1418","application_kind":"NORMAL","source_kit_code":"6H","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"MOTOR CUMMINS OU MWM","source_sheet":"FORD","source_row":23,"sort_order":18},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1421","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"MOTOR CUMMINS OU MWM","source_sheet":"FORD","source_row":24,"sort_order":19},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1422","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":25,"sort_order":20},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1512","application_kind":"NORMAL","source_kit_code":"7AC","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":26,"sort_order":21},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1514","application_kind":"NORMAL","source_kit_code":"5E","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":27,"sort_order":22},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1517","application_kind":"NORMAL","source_kit_code":"5E","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"COM 2 FUROS DE FIXAÇÃO","source_sheet":"FORD","source_row":28,"sort_order":23},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1517 Eletronico","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":29,"sort_order":24},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1517","application_kind":"NORMAL","source_kit_code":"7AC","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"2010 – 2011 – COM 4 FUROS FIXAÇÃO","source_sheet":"FORD","source_row":30,"sort_order":25},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1519","application_kind":"NORMAL","source_kit_code":"7AF","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"INVERTIDO – FIXAÇÃO DE 4 FUROS","source_sheet":"FORD","source_row":31,"sort_order":26},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1521","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":32,"sort_order":27},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1615","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":33,"sort_order":28},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1617","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":34,"sort_order":29},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1618","application_kind":"NORMAL","source_kit_code":"6A","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"MOTOR CUMMINS OU MWM","source_sheet":"FORD","source_row":35,"sort_order":30},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1619","application_kind":"NORMAL","source_kit_code":"6A","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"MOTOR CUMMINS OU MWM","source_sheet":"FORD","source_row":36,"sort_order":31},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1621 / 1622","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":37,"sort_order":32},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1717","application_kind":"NORMAL","source_kit_code":"7AC","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"2010 – 2011 – COM 4 FUROS FIXAÇÃO","source_sheet":"FORD","source_row":38,"sort_order":33},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1717 Eletronico","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":39,"sort_order":34},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1717 Eletronico","application_kind":"NORMAL","source_kit_code":"7AC","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"2012 – COM 4 FUROS FIXAÇÃO","source_sheet":"FORD","source_row":40,"sort_order":35},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1719","application_kind":"NORMAL","source_kit_code":"7AF","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"INVERTIDO – FIXAÇÃO DE 4 FUROS","source_sheet":"FORD","source_row":41,"sort_order":36},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1721","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":42,"sort_order":37},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1722","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"ABAIXO DE 93","source_sheet":"FORD","source_row":43,"sort_order":38},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1722","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"6 MARCHAS","source_sheet":"FORD","source_row":44,"sort_order":39},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1724","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"ABAIXO DE 93","source_sheet":"FORD","source_row":45,"sort_order":40},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"1724","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"6 MARCHAS","source_sheet":"FORD","source_row":46,"sort_order":41},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"2218","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":47,"sort_order":42},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"2223","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":48,"sort_order":43},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"2319","application_kind":"NORMAL","source_kit_code":"6A","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":49,"sort_order":44},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"2322","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"FORD","source_row":50,"sort_order":45},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"2422 / 2425 / 2626","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"6 ou 10 MARCHAS","source_sheet":"FORD","source_row":51,"sort_order":46},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"2422 / 2425 / 2622","application_kind":"NORMAL","source_kit_code":"6J","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"8 MARCHAS","source_sheet":"FORD","source_row":52,"sort_order":47},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"2422","application_kind":"NORMAL","source_kit_code":"11A","source_servo_label":"AL-10","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO","source_sheet":"FORD","source_row":53,"sort_order":48},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"2428","application_kind":"NORMAL","source_kit_code":"11A","source_servo_label":"AL-10","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO","source_sheet":"FORD","source_row":54,"sort_order":49},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"2626","application_kind":"NORMAL","source_kit_code":"6O","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"8 MARCHAS","source_sheet":"FORD","source_row":55,"sort_order":50},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"2628","application_kind":"NORMAL","source_kit_code":"11A","source_servo_label":"AL-10","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO","source_sheet":"FORD","source_row":56,"sort_order":51},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"2630","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"10 MARCHAS C/ CILINDRO AUXILIAR","source_sheet":"FORD","source_row":57,"sort_order":52},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"2631","application_kind":"NORMAL","source_kit_code":"7F","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"10 MARCHAS C/ SERVO ORIGINAL","source_sheet":"FORD","source_row":58,"sort_order":53},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"2726","application_kind":"NORMAL","source_kit_code":"5P","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"SEM SENSOR DE DESGASTE (PAINEL) NO WABCO","source_sheet":"FORD","source_row":59,"sort_order":54},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"3224","application_kind":"NORMAL","source_kit_code":"6A","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"MOTOR CUMMINS OU MWM","source_sheet":"FORD","source_row":60,"sort_order":55},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"3530","application_kind":"NORMAL","source_kit_code":"6J","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"8 MARCHAS","source_sheet":"FORD","source_row":61,"sort_order":56},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"4030","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"10 MARCHAS","source_sheet":"FORD","source_row":62,"sort_order":57},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"4030","application_kind":"NORMAL","source_kit_code":"7F","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"C/ SERVO ORIGINAL","source_sheet":"FORD","source_row":63,"sort_order":58},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"4331","application_kind":"NORMAL","source_kit_code":"7F","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"C/ SERVO ORIGINAL","source_sheet":"FORD","source_row":64,"sort_order":59},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"12.000 PIT BUL","application_kind":"NORMAL","source_kit_code":"6L","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"A PARTIR DE 2000","source_sheet":"FORD","source_row":65,"sort_order":60},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"14.000 PIT BUL","application_kind":"NORMAL","source_kit_code":"6L","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"A PARTIR DE 2000","source_sheet":"FORD","source_row":66,"sort_order":61},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"16.000 PIT BUL","application_kind":"NORMAL","source_kit_code":"6L","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"A PARTIR DE 2000","source_sheet":"FORD","source_row":67,"sort_order":62},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"12.000 HD","application_kind":"NORMAL","source_kit_code":"6G","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"DE 1996 A 2000","source_sheet":"FORD","source_row":68,"sort_order":63},{"brand_slug":"ford","category":"TRUCK","vehicle_model":"14.000 HD","application_kind":"NORMAL","source_kit_code":"6G","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"ABAIXO DE 2000","source_sheet":"FORD","source_row":69,"sort_order":64},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"6.90 / 7.90","application_kind":"NORMAL","source_kit_code":"2C","source_servo_label":"MBF-025","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":6,"sort_order":1},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"7.100 / 7.110","application_kind":"NORMAL","source_kit_code":"6G","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":7,"sort_order":2},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"8.120 / 8.140","application_kind":"NORMAL","source_kit_code":"10A","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"MOTOR MWM","source_sheet":"VOLKSWAGEN","source_row":8,"sort_order":3},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"8.120","application_kind":"NORMAL","source_kit_code":"10C","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"SERVO REBAIXADO NA FLANGE / CUMMINS","source_sheet":"VOLKSWAGEN","source_row":9,"sort_order":4},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"8.150","application_kind":"NORMAL","source_kit_code":"10A","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"MOTOR MWM","source_sheet":"VOLKSWAGEN","source_row":10,"sort_order":5},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"8.150 Delivery","application_kind":"NORMAL","source_kit_code":"10C","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"SERVO REBAIXADO NA FLANGE / CUMMINS","source_sheet":"VOLKSWAGEN","source_row":11,"sort_order":6},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"9.150 Delivery","application_kind":"NORMAL","source_kit_code":"10A","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"MOTOR MWM","source_sheet":"VOLKSWAGEN","source_row":12,"sort_order":7},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"9.150 Delivery","application_kind":"NORMAL","source_kit_code":"10C","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"SERVO REBAIXADO NA FLANGE / CUMMINS","source_sheet":"VOLKSWAGEN","source_row":13,"sort_order":8},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"9150-E Worker","application_kind":"NORMAL","source_kit_code":"10C","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"SERVO REBAIXADO NA FLANGE / CUMMINS","source_sheet":"VOLKSWAGEN","source_row":14,"sort_order":9},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"9.160","application_kind":"NORMAL","source_kit_code":"10C","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"SERVO REBAIXADO NA FLANGE / CUMMINS","source_sheet":"VOLKSWAGEN","source_row":15,"sort_order":10},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"11130 / 11.140","application_kind":"NORMAL","source_kit_code":"2C","source_servo_label":"MBF-025","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":16,"sort_order":11},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"12.140 H","application_kind":"NORMAL","source_kit_code":"5B","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":17,"sort_order":12},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"12.140 T","application_kind":"NORMAL","source_kit_code":"10A","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":18,"sort_order":13},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"12.170","application_kind":"NORMAL","source_kit_code":"6A","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":19,"sort_order":14},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"13.130","application_kind":"NORMAL","source_kit_code":"2C","source_servo_label":"MBF-025","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":20,"sort_order":15},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"13.150","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":21,"sort_order":16},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"13.170 / 13.180","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":22,"sort_order":17},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"13.190","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":23,"sort_order":18},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"14.140","application_kind":"NORMAL","source_kit_code":"2C","source_servo_label":"MBF-025","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":24,"sort_order":19},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"14.150","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":25,"sort_order":20},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"14.170","application_kind":"NORMAL","source_kit_code":"6A","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":26,"sort_order":21},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"14.210","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"A PARTIR 93","source_sheet":"VOLKSWAGEN","source_row":27,"sort_order":22},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"14.210","application_kind":"NORMAL","source_kit_code":"5C","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"ATÉ 92","source_sheet":"VOLKSWAGEN","source_row":28,"sort_order":23},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"14.220","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":29,"sort_order":24},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"14.400","application_kind":"NORMAL","source_kit_code":"2C","source_servo_label":"MBF-025","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":30,"sort_order":25},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"15.170","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":31,"sort_order":26},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"15.180","application_kind":"NORMAL","source_kit_code":"5X","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":32,"sort_order":27},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"15.180 Constellation","application_kind":"NORMAL","source_kit_code":"2H","source_servo_label":"MBF-025","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":33,"sort_order":28},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"15.190","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"SÓ C/ CILINDRO","source_sheet":"VOLKSWAGEN","source_row":34,"sort_order":29},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"15.190","application_kind":"NORMAL","source_kit_code":"11B","source_servo_label":"AL-10","catalog_resolution_status":"RESOLVED","observation":"C/ WABCO PEQUENO","source_sheet":"VOLKSWAGEN","source_row":35,"sort_order":30},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"16.150","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":36,"sort_order":31},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"16.170","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":37,"sort_order":32},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"16.180","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":38,"sort_order":33},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"16.200","application_kind":"NORMAL","source_kit_code":"6B","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":39,"sort_order":34},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"16.210 H","application_kind":"NORMAL","source_kit_code":"5C","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":40,"sort_order":35},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"16.210 / 16.220","application_kind":"NORMAL","source_kit_code":"6C","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":41,"sort_order":36},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"16.220","application_kind":"NORMAL","source_kit_code":"7F","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"ACIMA 94 C/ WABCO","source_sheet":"VOLKSWAGEN","source_row":42,"sort_order":37},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"16.300","application_kind":"NORMAL","source_kit_code":"6B","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"10 MARCHAS","source_sheet":"VOLKSWAGEN","source_row":43,"sort_order":38},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"17.180","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":44,"sort_order":39},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"17.210 / 17.220","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":45,"sort_order":40},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"17.230","application_kind":"NORMAL","source_kit_code":"11B","source_servo_label":"AL-10","catalog_resolution_status":"RESOLVED","observation":"C/ WABCO PEQUENO","source_sheet":"VOLKSWAGEN","source_row":46,"sort_order":41},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"17.300","application_kind":"NORMAL","source_kit_code":"6J","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"8 MARCHAS","source_sheet":"VOLKSWAGEN","source_row":47,"sort_order":42},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"17.300","application_kind":"NORMAL","source_kit_code":"6B","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"6 E 10 MARCHAS","source_sheet":"VOLKSWAGEN","source_row":48,"sort_order":43},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"17.310","application_kind":"NORMAL","source_kit_code":"7Z","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO SERVO ORIGINAL","source_sheet":"VOLKSWAGEN","source_row":49,"sort_order":44},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"18.310","application_kind":"NORMAL","source_kit_code":"7X","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO SERVO ORIGINAL","source_sheet":"VOLKSWAGEN","source_row":50,"sort_order":45},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"23.210","application_kind":"NORMAL","source_kit_code":"6F","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":51,"sort_order":46},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"23.220 TITAN","application_kind":"NORMAL","source_kit_code":"7X","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO SERVO ORIGINAL","source_sheet":"VOLKSWAGEN","source_row":52,"sort_order":47},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"23.250 Eletronico","application_kind":"NORMAL","source_kit_code":"7X","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO SERVO ORIGINAL","source_sheet":"VOLKSWAGEN","source_row":53,"sort_order":48},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"23310 TITAN","application_kind":"NORMAL","source_kit_code":"7Z","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO SERVO ORIGINAL","source_sheet":"VOLKSWAGEN","source_row":54,"sort_order":49},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"24.220 / 24.250","application_kind":"NORMAL","source_kit_code":"6B","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"10 MARCHAS","source_sheet":"VOLKSWAGEN","source_row":55,"sort_order":50},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"24.220 / 24.250","application_kind":"NORMAL","source_kit_code":"6J","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"08 MARCHAS","source_sheet":"VOLKSWAGEN","source_row":56,"sort_order":51},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"24.250 CONSTELLATION","application_kind":"NORMAL","source_kit_code":"2H","source_servo_label":"MBF-025","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":57,"sort_order":52},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"26.260 Worker","application_kind":"NORMAL","source_kit_code":"7Z","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"10 MARCHAS ANO 2008","source_sheet":"VOLKSWAGEN","source_row":58,"sort_order":53},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"26.300","application_kind":"NORMAL","source_kit_code":"6B","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"10 MARCHAS","source_sheet":"VOLKSWAGEN","source_row":59,"sort_order":54},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"31.300","application_kind":"NORMAL","source_kit_code":"6B","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"10 MARCHAS","source_sheet":"VOLKSWAGEN","source_row":60,"sort_order":55},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"35.300","application_kind":"NORMAL","source_kit_code":"6B","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"10 MARCHAS","source_sheet":"VOLKSWAGEN","source_row":61,"sort_order":56},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"35.300","application_kind":"NORMAL","source_kit_code":"6J","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"08 MARCHAS","source_sheet":"VOLKSWAGEN","source_row":62,"sort_order":57},{"brand_slug":"volkswagen","category":"TRUCK","vehicle_model":"40.300","application_kind":"NORMAL","source_kit_code":"6B","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"10 MARCHAS","source_sheet":"VOLKSWAGEN","source_row":63,"sort_order":58},{"brand_slug":"volkswagen","category":"BUS","vehicle_model":"16.180","application_kind":"NORMAL","source_kit_code":"6B","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"VOLKSWAGEN","source_row":68,"sort_order":59},{"brand_slug":"volkswagen","category":"BUS","vehicle_model":"16.210","application_kind":"NORMAL","source_kit_code":"7F","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO SERVO ORIGINAL","source_sheet":"VOLKSWAGEN","source_row":69,"sort_order":60},{"brand_slug":"volkswagen","category":"BUS","vehicle_model":"18.310","application_kind":"NORMAL","source_kit_code":"7Z","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"4 FUROS DE FIXAÇÃO DO SERVO ORIGINAL","source_sheet":"VOLKSWAGEN","source_row":70,"sort_order":61},{"brand_slug":"volkswagen","category":"MICROBUS","vehicle_model":"8.120 / 8.140 / 8.150","application_kind":"NORMAL","source_kit_code":"10A","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"MWM","source_sheet":"VOLKSWAGEN","source_row":75,"sort_order":62},{"brand_slug":"volkswagen","category":"MICROBUS","vehicle_model":"8150 DELIVERY","application_kind":"NORMAL","source_kit_code":"10C","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"SERVO REBAIXADO NA FLANGE – CUMMINS","source_sheet":"VOLKSWAGEN","source_row":76,"sort_order":63},{"brand_slug":"volkswagen","category":"MICROBUS","vehicle_model":"9.150","application_kind":"NORMAL","source_kit_code":"10C","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"SERVO REBAIXADO NA FLANGE – CUMMINS","source_sheet":"VOLKSWAGEN","source_row":77,"sort_order":64},{"brand_slug":"volkswagen","category":"MICROBUS","vehicle_model":"9.150","application_kind":"NORMAL","source_kit_code":"10A","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"MWM","source_sheet":"VOLKSWAGEN","source_row":78,"sort_order":65},{"brand_slug":"scania","category":null,"vehicle_model":"112 H / 112HS","application_kind":"NORMAL","source_kit_code":"7H","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"SCANIA","source_row":6,"sort_order":1},{"brand_slug":"scania","category":null,"vehicle_model":"142 H","application_kind":"NORMAL","source_kit_code":"7H","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"SCANIA","source_row":7,"sort_order":2},{"brand_slug":"scania","category":null,"vehicle_model":"K112 / K113","application_kind":"NORMAL","source_kit_code":"7I","source_servo_label":"BR-040","catalog_resolution_status":"UNRESOLVED","observation":null,"source_sheet":"SCANIA","source_row":8,"sort_order":3},{"brand_slug":"scania","category":null,"vehicle_model":"142 HS - HW","application_kind":"NORMAL","source_kit_code":"7I","source_servo_label":"BR-040","catalog_resolution_status":"UNRESOLVED","observation":null,"source_sheet":"SCANIA","source_row":9,"sort_order":4},{"brand_slug":"scania","category":null,"vehicle_model":"113 H / F113","application_kind":"NORMAL","source_kit_code":"7J","source_servo_label":"BR-040","catalog_resolution_status":"UNRESOLVED","observation":null,"source_sheet":"SCANIA","source_row":10,"sort_order":5},{"brand_slug":"scania","category":null,"vehicle_model":"F 113 ônibus","application_kind":"NORMAL","source_kit_code":"7D","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"SCANIA","source_row":11,"sort_order":6},{"brand_slug":"scania","category":null,"vehicle_model":"K 112 ônibus","application_kind":"NORMAL","source_kit_code":"7K","source_servo_label":"BR-040","catalog_resolution_status":"UNRESOLVED","observation":null,"source_sheet":"SCANIA","source_row":12,"sort_order":7},{"brand_slug":"scania","category":null,"vehicle_model":"K 113 ônibus","application_kind":"NORMAL","source_kit_code":"7L","source_servo_label":"BR-040","catalog_resolution_status":"UNRESOLVED","observation":null,"source_sheet":"SCANIA","source_row":13,"sort_order":8},{"brand_slug":"scania","category":null,"vehicle_model":"K 113 ônibus","application_kind":"NORMAL","source_kit_code":"7J","source_servo_label":"BR-040","catalog_resolution_status":"UNRESOLVED","observation":"ATÉ 1990","source_sheet":"SCANIA","source_row":14,"sort_order":9},{"brand_slug":"volvo","category":null,"vehicle_model":"NL-10 CAMINHÃO","application_kind":"NORMAL","source_kit_code":"7M","source_servo_label":"BR-040","catalog_resolution_status":"UNRESOLVED","observation":null,"source_sheet":"VOLVO","source_row":6,"sort_order":1},{"brand_slug":"volvo","category":null,"vehicle_model":"NL-12 / NL-12 CAM.","application_kind":"NORMAL","source_kit_code":"7O","source_servo_label":"BR-040","catalog_resolution_status":"UNRESOLVED","observation":null,"source_sheet":"VOLVO","source_row":7,"sort_order":2},{"brand_slug":"volvo","category":null,"vehicle_model":"B10M ÔNIBUS","application_kind":"NORMAL","source_kit_code":"7G","source_servo_label":"BR-040","catalog_resolution_status":"UNRESOLVED","observation":null,"source_sheet":"VOLVO","source_row":8,"sort_order":3},{"brand_slug":"agrale","category":null,"vehicle_model":"7500 / 8500 / 9200","application_kind":"NORMAL","source_kit_code":"5H","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"AGRALE","source_row":6,"sort_order":1},{"brand_slug":"agrale","category":null,"vehicle_model":"MA 10","application_kind":"NORMAL","source_kit_code":"5H","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"CHASSI IGUAL AO DO CAMINHÃO","source_sheet":"AGRALE","source_row":7,"sort_order":2},{"brand_slug":"agrale","category":null,"vehicle_model":"MA 12","application_kind":"NORMAL","source_kit_code":"5Z","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"INV","source_sheet":"AGRALE","source_row":8,"sort_order":3},{"brand_slug":"agrale","category":null,"vehicle_model":"MA 15","application_kind":"NORMAL","source_kit_code":"5Z","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"INV","source_sheet":"AGRALE","source_row":9,"sort_order":4},{"brand_slug":"agrale","category":null,"vehicle_model":"MA 8.5","application_kind":"NORMAL","source_kit_code":"5W","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"INV FUR ESP ANO 2007 / 2008 / 2009","source_sheet":"AGRALE","source_row":10,"sort_order":5},{"brand_slug":"agrale","category":null,"vehicle_model":"MA 9.2","application_kind":"NORMAL","source_kit_code":"5H","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"CHASSI IGUAL AO DO CAMINHÃO","source_sheet":"AGRALE","source_row":11,"sort_order":6},{"brand_slug":"agrale","category":null,"vehicle_model":"MT 12 ÔNIBUS","application_kind":"NORMAL","source_kit_code":"5F","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"****JÁ SAI DA MONTADORA*** COM SAFISA","source_sheet":"AGRALE","source_row":12,"sort_order":7},{"brand_slug":"agrale","category":null,"vehicle_model":"MT-12 CAMINHÃO","application_kind":"NORMAL","source_kit_code":"5F","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"AGRALE","source_row":13,"sort_order":8},{"brand_slug":"agrale","category":null,"vehicle_model":"A8","application_kind":"NORMAL","source_kit_code":"5H","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"AGRALE","source_row":14,"sort_order":9},{"brand_slug":"agrale","category":null,"vehicle_model":"DW9","application_kind":"NORMAL","source_kit_code":"7AD","source_servo_label":"BR-040","catalog_resolution_status":"RESOLVED","observation":"INV FUR ESP Carroceria Volare – Motor MBB","source_sheet":"AGRALE","source_row":15,"sort_order":10},{"brand_slug":"agrale","category":null,"vehicle_model":"V8","application_kind":"NORMAL","source_kit_code":"10B","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"ANO 2005 – 2006","source_sheet":"AGRALE","source_row":16,"sort_order":11},{"brand_slug":"agrale","category":null,"vehicle_model":"V8","application_kind":"NORMAL","source_kit_code":"5W","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"INV FUR ESP ACIMA DE 2007","source_sheet":"AGRALE","source_row":17,"sort_order":12},{"brand_slug":"agrale","category":null,"vehicle_model":"V8","application_kind":"NORMAL","source_kit_code":"10D","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"ANO 2003 / 2004","source_sheet":"AGRALE","source_row":18,"sort_order":13},{"brand_slug":"agrale","category":null,"vehicle_model":"W8","application_kind":"NORMAL","source_kit_code":"10D","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"ANO 2003 / 2004","source_sheet":"AGRALE","source_row":19,"sort_order":14},{"brand_slug":"agrale","category":null,"vehicle_model":"W8","application_kind":"NORMAL","source_kit_code":"10B","source_servo_label":"MC-040","catalog_resolution_status":"RESOLVED","observation":"ACIMA 2005","source_sheet":"AGRALE","source_row":20,"sort_order":15},{"brand_slug":"agrale","category":null,"vehicle_model":"W8 RHD","application_kind":"NORMAL","source_kit_code":"5W","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"INV FUR ESP ANO 2007 A 2011","source_sheet":"AGRALE","source_row":21,"sort_order":16},{"brand_slug":"agrale","category":null,"vehicle_model":"W9","application_kind":"NORMAL","source_kit_code":"5W","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"INV FUR ESP","source_sheet":"AGRALE","source_row":22,"sort_order":17},{"brand_slug":"metalfor","category":null,"vehicle_model":"Futura 2200","application_kind":"NORMAL","source_kit_code":"5I","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"Pulverizador – Máquina Unificada SE","source_sheet":"METALFOR","source_row":6,"sort_order":1},{"brand_slug":"metalfor","category":null,"vehicle_model":"7040","application_kind":"NORMAL","source_kit_code":"6R","source_servo_label":"VF-040","catalog_resolution_status":"RESOLVED","observation":"Pulverizador – motor Cummins 6BT","source_sheet":"METALFOR","source_row":7,"sort_order":2},{"brand_slug":"gmc","category":null,"vehicle_model":"12.170 / 12.190","application_kind":"NORMAL","source_kit_code":"5G","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"GMC","source_row":6,"sort_order":1},{"brand_slug":"gmc","category":null,"vehicle_model":"14.000 CHEVROLET","application_kind":"NORMAL","source_kit_code":"5G","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"GMC","source_row":7,"sort_order":2},{"brand_slug":"gmc","category":null,"vehicle_model":"14.190","application_kind":"NORMAL","source_kit_code":"5G","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"GMC","source_row":8,"sort_order":3},{"brand_slug":"gmc","category":null,"vehicle_model":"15.190","application_kind":"NORMAL","source_kit_code":"5G","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":"SE FOR CARA CHATA NÃO DÁ","source_sheet":"GMC","source_row":9,"sort_order":4},{"brand_slug":"gmc","category":null,"vehicle_model":"16220","application_kind":"NORMAL","source_kit_code":"5G","source_servo_label":"MBF-040","catalog_resolution_status":"RESOLVED","observation":null,"source_sheet":"GMC","source_row":10,"sort_order":5}]}$vehicle_applications$::jsonb;
  v_count integer;
  v_codes text[];
  v_payload_sha256 text;
begin
  select encode(
    extensions.digest(
      convert_to(
        pg_temp.vehicle_applications_canonical_json(v_payload),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  into v_payload_sha256;

  if v_payload_sha256 is distinct from v_expected_payload_sha256 then
    raise exception using
      errcode = '23514',
      message = 'Vehicle application payload digest does not match the approved canonical content.';
  end if;

  if jsonb_array_length(v_payload -> 'brands') <> 8
    or jsonb_array_length(v_payload -> 'applications') <> 295 then
    raise exception using
      errcode = '23514',
      message = 'Vehicle application payload must contain exactly 8 brands and 295 rows.';
  end if;

  select count(*)
  into v_count
  from jsonb_to_recordset(v_payload -> 'brands') as brand (
    slug text,
    name text,
    display_order integer
  )
  where (slug, name, display_order) in (
    ('mercedes-benz', 'Mercedes-Benz', 1),
    ('ford', 'Ford', 2),
    ('volkswagen', 'Volkswagen', 3),
    ('scania', 'Scania', 4),
    ('volvo', 'Volvo', 5),
    ('agrale', 'Agrale', 6),
    ('metalfor', 'Metalfor', 7),
    ('gmc', 'GMC', 8)
  );

  if v_count <> 8 then
    raise exception using
      errcode = '23514',
      message = 'Vehicle application brand payload differs from the approved set.';
  end if;

  select count(*)
  into v_count
  from jsonb_to_recordset(v_payload -> 'applications') as application (
    application_kind text,
    catalog_resolution_status text
  )
  where application_kind = 'NORMAL';

  if v_count <> 294 then
    raise exception using
      errcode = '23514',
      message = 'Vehicle application payload must contain exactly 294 NORMAL rows.';
  end if;

  select count(*)
  into v_count
  from jsonb_to_recordset(v_payload -> 'applications') as application (
    application_kind text,
    catalog_resolution_status text
  )
  where application_kind = 'RESTRICTION';

  if v_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'Vehicle application payload must contain exactly 1 RESTRICTION row.';
  end if;

  select count(*), array_agg(distinct source_kit_code order by source_kit_code)
  into v_count, v_codes
  from jsonb_to_recordset(v_payload -> 'applications') as application (
    application_kind text,
    catalog_resolution_status text,
    source_kit_code text
  )
  where application_kind = 'NORMAL'
    and catalog_resolution_status = 'UNRESOLVED';

  if v_count <> 11
    or v_codes is distinct from array[
      '7B', '7C', '7G', '7I', '7J', '7K', '7L', '7M', '7O'
    ]::text[] then
    raise exception using
      errcode = '23514',
      message = 'Vehicle application unresolved rows differ from the approved 11 rows and 9 codes.';
  end if;

  select count(*)
  into v_count
  from jsonb_to_recordset(v_payload -> 'applications') as application (
    brand_slug text,
    vehicle_model text,
    application_kind text,
    source_kit_code text,
    source_servo_label text,
    catalog_resolution_status text,
    observation text,
    source_sheet text,
    source_row integer
  )
  where brand_slug = 'mercedes-benz'
    and vehicle_model = '2423 Câmbio ZF'
    and application_kind = 'RESTRICTION'
    and source_kit_code is null
    and source_servo_label is null
    and catalog_resolution_status = 'NOT_APPLICABLE'
    and observation = 'NÃO DÁ INSTALAÇÃO'
    and source_sheet = 'MERCEDES-BENZ'
    and source_row = 104;

  if v_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'The approved Mercedes-Benz 2423 Câmbio ZF restriction is missing or changed.';
  end if;

  select count(*)
  into v_count
  from (
    select source_sheet, source_row
    from jsonb_to_recordset(v_payload -> 'applications') as application (
      source_sheet text,
      source_row integer
    )
    group by source_sheet, source_row
    having count(*) > 1
  ) as duplicate_source;

  if v_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'Vehicle application payload contains duplicate source locations.';
  end if;

  select count(*)
  into v_count
  from (
    select
      brand_slug,
      category,
      vehicle_model,
      application_kind,
      source_kit_code,
      source_servo_label,
      catalog_resolution_status,
      observation
    from jsonb_to_recordset(v_payload -> 'applications') as application (
      brand_slug text,
      category text,
      vehicle_model text,
      application_kind text,
      source_kit_code text,
      source_servo_label text,
      catalog_resolution_status text,
      observation text
    )
    group by
      brand_slug,
      category,
      vehicle_model,
      application_kind,
      source_kit_code,
      source_servo_label,
      catalog_resolution_status,
      observation
    having count(*) > 1
  ) as duplicate_application;

  if v_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'Vehicle application payload contains exact duplicate applications.';
  end if;

  select count(*)
  into v_count
  from jsonb_to_recordset(v_payload -> 'applications') as application (
    application_kind text,
    source_kit_code text,
    catalog_resolution_status text
  )
  left join public.commercial_configuration_codes as commercial_code
    on commercial_code.code = application.source_kit_code
   and commercial_code.is_active
  where application.application_kind = 'NORMAL'
    and application.catalog_resolution_status = 'RESOLVED'
    and commercial_code.id is null;

  if v_count <> 0 then
    raise exception using
      errcode = '23503',
      message = 'A RESOLVED vehicle application does not match one active commercial code.';
  end if;

  select count(*)
  into v_count
  from jsonb_to_recordset(v_payload -> 'applications') as application (
    application_kind text,
    source_kit_code text,
    catalog_resolution_status text
  )
  join public.commercial_configuration_codes as commercial_code
    on commercial_code.code = application.source_kit_code
  where application.application_kind = 'NORMAL'
    and application.catalog_resolution_status = 'UNRESOLVED';

  if v_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'An approved UNRESOLVED vehicle application unexpectedly matches the catalog.';
  end if;

  insert into public.vehicle_application_brands (slug, name, display_order)
  select slug, name, display_order
  from jsonb_to_recordset(v_payload -> 'brands') as brand (
    slug text,
    name text,
    display_order smallint
  )
  order by display_order;

  insert into public.vehicle_applications (
    brand_id,
    category,
    vehicle_model,
    application_kind,
    source_kit_code,
    source_servo_label,
    commercial_configuration_code_id,
    catalog_resolution_status,
    observation,
    source_sheet,
    source_row,
    sort_order
  )
  select
    brand.id,
    application.category,
    application.vehicle_model,
    application.application_kind,
    application.source_kit_code,
    application.source_servo_label,
    commercial_code.id,
    application.catalog_resolution_status,
    application.observation,
    application.source_sheet,
    application.source_row,
    application.sort_order
  from jsonb_to_recordset(v_payload -> 'applications') as application (
    brand_slug text,
    category text,
    vehicle_model text,
    application_kind text,
    source_kit_code text,
    source_servo_label text,
    catalog_resolution_status text,
    observation text,
    source_sheet text,
    source_row integer,
    sort_order integer
  )
  join public.vehicle_application_brands as brand
    on brand.slug = application.brand_slug
  left join public.commercial_configuration_codes as commercial_code
    on commercial_code.code = application.source_kit_code
   and application.catalog_resolution_status = 'RESOLVED'
  order by brand.display_order, application.sort_order;

  if (select count(*) from public.vehicle_application_brands) <> 8
    or (select count(*) from public.vehicle_applications) <> 295
    or (
      select count(*)
      from public.vehicle_applications
      where application_kind = 'NORMAL'
    ) <> 294
    or (
      select count(*)
      from public.vehicle_applications
      where application_kind = 'RESTRICTION'
    ) <> 1
    or (
      select count(*)
      from public.vehicle_applications
      where application_kind = 'NORMAL'
        and catalog_resolution_status = 'UNRESOLVED'
        and commercial_configuration_code_id is null
    ) <> 11 then
    raise exception using
      errcode = '23514',
      message = 'Vehicle application post-import assertions failed.';
  end if;
end;
$$;

alter table public.vehicle_application_brands enable row level security;
alter table public.vehicle_applications enable row level security;

create policy vehicle_application_brands_select_active_users
on public.vehicle_application_brands
for select
to authenticated
using ((select private.is_active_profile()));

create policy vehicle_applications_select_active_users
on public.vehicle_applications
for select
to authenticated
using ((select private.is_active_profile()));

revoke all privileges on table
  public.vehicle_application_brands,
  public.vehicle_applications
from public, anon, authenticated;

grant select on table
  public.vehicle_application_brands,
  public.vehicle_applications
to authenticated;

commit;
