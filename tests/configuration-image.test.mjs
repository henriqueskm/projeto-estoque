import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/catalog/configuration-image/route.ts";
import { createConfigurationImageResource } from "../lib/configuration-image-resource.ts";
import { createCompatibleKitImageMap } from "../lib/compatible-kit-images.ts";
import { recordPhotoPerformance } from "../lib/photo-performance-audit.ts";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function fixture() {
  return {
    profiles: [{ id: "user", is_active: true }],
    commercial_configurations: [
      { id, servo_id: "servo", installation_kit_id: "kit", is_active: true, image_path: "private/server-selected.png" },
      { id: otherId, servo_id: "servo", installation_kit_id: "kit", is_active: true, image_path: "private/other.png" },
    ],
    items: [{ id: "servo", item_type: "SERVO", is_active: true }, { id: "kit", item_type: "INSTALLATION_KIT", is_active: true }],
    commercial_configuration_codes: [{ id: "alias", configuration_id: id, is_active: true }],
    configuration_stock_balances: [{ configuration_id: id, quantity: 0 }],
  };
}
function client(tables, { signedError = false, user = "user", queryError = null } = {}) {
  const reads = [], signatures = [];
  return { reads, signatures,
    auth: { getClaims: async () => ({ data: { claims: { sub: user } }, error: null }) },
    from(table) {
      const filters = [];
      let limit = Infinity;
      const call = { table, filters };
      reads.push(call);
      const result = () => ({ data: (tables[table] ?? []).filter((row) => filters.every(([column, values]) => values.includes(row[column]))).slice(0, limit), error: table === queryError ? {} : null });
      const query = {
        select() { return query; },
        eq(column, value) { filters.push([column, [value]]); return query; },
        in(column, values) { filters.push([column, values]); return query; },
        limit(value) { limit = value; return query; },
        async maybeSingle() { const value = result(); return { ...value, data: value.data[0] ?? null }; },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return query;
    },
    storage: { from(bucket) { return { async createSignedUrl(path, lifetime) {
      signatures.push({ bucket, path, lifetime });
      return { data: signedError ? null : { signedUrl: "https://media.invalid/signed" }, error: signedError ? {} : null };
    } }; } },
  };
}
const request = (query = `configurationId=${id}`) => new Request(`https://nk.invalid/api/catalog/configuration-image?${query}`);
async function run(tables, options, query) {
  globalThis.__NK_IMAGE_CLIENT__ = client(tables, options);
  const response = await GET(request(query));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return { response, body: await response.json(), client: globalThis.__NK_IMAGE_CLIENT__ };
}

test("assina somente a configuração pedida com path do servidor e JWT/RLS da sessão", async () => {
  const value = await run(fixture());
  assert.equal(value.response.status, 200);
  assert.deepEqual(value.body, { imageUrl: "https://media.invalid/signed", expiresInSeconds: 600 });
  assert.deepEqual(value.client.signatures, [{ bucket: "commercial-catalog-images", path: "private/server-selected.png", lifetime: 600 }]);
  assert.deepEqual(value.client.reads.find((read) => read.table === "commercial_configurations").filters, [["id", [id]]]);
  assert.equal(JSON.stringify(value.body).includes("private/"), false);
});
test("rejeita anônimo e perfil inativo antes do catálogo/Storage", async () => {
  const anonymous = await run(fixture(), { user: null });
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.client.reads.length, 0);
  const tables = fixture(); tables.profiles[0].is_active = false;
  const inactive = await run(tables);
  assert.equal(inactive.response.status, 403);
  assert.deepEqual(inactive.client.reads.map((read) => read.table), ["profiles"]);
  assert.equal(inactive.client.signatures.length, 0);
});
test("rejeita paths, bucket, URL, UUID inválido e parâmetro duplicado", async () => {
  for (const query of [`configurationId=${id}&image_path=evil`, `configurationId=${id}&bucket=evil`, `configurationId=${id}&imageUrl=evil`, "configurationId=invalid", `configurationId=${id}&configurationId=${otherId}`]) {
    const value = await run(fixture(), {}, query);
    assert.equal(value.response.status, 400);
    assert.equal(value.client.signatures.length, 0);
  }
});
test("configuração inexistente/RLS-oculta, foto ausente e falha de assinatura são explícitas", async () => {
  const hidden = fixture(); hidden.commercial_configurations = [];
  assert.equal((await run(hidden)).response.status, 404);
  const missing = fixture(); missing.commercial_configurations[0].image_path = null;
  const absent = await run(missing);
  assert.equal(absent.response.status, 404);
  assert.equal(absent.body.error, "Foto não disponível.");
  assert.equal(absent.client.signatures.length, 0);
  assert.equal((await run(fixture(), { signedError: true })).response.status, 502);
  assert.equal((await run(fixture(), { queryError: "items" })).response.status, 503);
});
test("inativas com saldo montado preservam imagem, zero exige config/componentes/alias ativos", async () => {
  for (const kind of ["configuration", "servo", "kit", "alias"]) {
    const tables = fixture();
    if (kind === "configuration") tables.commercial_configurations[0].is_active = false;
    if (kind === "servo") tables.items[0].is_active = false;
    if (kind === "kit") tables.items[1].is_active = false;
    if (kind === "alias") tables.commercial_configuration_codes[0].is_active = false;
    assert.equal((await run(tables)).response.status, 404, kind);
    tables.configuration_stock_balances[0].quantity = 2;
    assert.equal((await run(tables)).response.status, 200, kind);
  }
  const wrongType = fixture(); wrongType.items[0].item_type = "LOOSE_PART";
  wrongType.configuration_stock_balances[0].quantity = 2;
  assert.equal((await run(wrongType)).response.status, 404);
});
test("existência do alias usa filtro antes do limit, mesmo com mais de mil aliases", async () => {
  const tables = fixture();
  tables.commercial_configuration_codes = Array.from({ length: 1501 }, (_, index) => ({ id: `alias-${index}`, configuration_id: id, is_active: index === 1500 }));
  assert.equal((await run(tables)).response.status, 200);
});
test("reutilização local expira conservadoramente desde início do request e retry invalida", async () => {
  let now = 1000, calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, `/api/catalog/configuration-image?configurationId=${id}`);
    assert.deepEqual(options, { cache: "no-store", credentials: "same-origin" });
    now += 100_000;
    return { ok: true, json: async () => ({ imageUrl: `url-${calls}`, expiresInSeconds: 600 }) };
  };
  const resource = createConfigurationImageResource(id, fetcher, () => now);
  assert.equal((await resource.resolve()).reused, false);
  assert.equal((await resource.resolve()).reused, true);
  assert.equal(calls, 1);
  now = 541_000;
  assert.equal((await resource.resolve()).imageUrl, "url-2");
  resource.invalidate();
  assert.equal((await resource.resolve()).imageUrl, "url-3");
});
test("request pendente é compartilhado localmente e falha permite retry", async () => {
  let finish, calls = 0;
  const resource = createConfigurationImageResource(id, async () => {
    calls++;
    return new Promise((resolve) => { finish = resolve; });
  });
  const first = resource.resolve(), second = resource.resolve();
  assert.equal(calls, 1);
  finish({ ok: false, json: async () => ({ error: "failed" }) });
  await Promise.all([assert.rejects(first), assert.rejects(second)]);
  const retry = resource.resolve();
  assert.equal(calls, 2);
  finish({ ok: true, json: async () => ({ imageUrl: "new-url", expiresInSeconds: 600 }) });
  assert.equal((await retry).imageUrl, "new-url");
});
test("kits agrupam metadados/aliases por configuração sem assinar outras opções", () => {
  const option = { installationKitId: "kit", configurationId: id, commercialCodes: ["2A", "1D", "1B", "1B"], servoCode: "2", servoDescription: "Servo", servoModel: "MBF-025", installationKitCode: "KT-18", description: "Caixa", hasImage: true };
  const map = createCompatibleKitImageMap([option, option, { ...option, configurationId: otherId, commercialCodes: ["3A"] }]);
  assert.equal(map.get("kit").length, 2);
  assert.deepEqual(map.get("kit")[0].commercialCodes, ["1B", "1D", "2A"]);
  assert.equal(map.get("kit")[0].servoModel, "MBF-025");
  assert.equal("imageUrl" in map.get("kit")[0], false);
});

test("instrumentação foto é inerte sem painel/storage e contém somente metadados técnicos", () => {
  const old = { document: globalThis.document, window: globalThis.window, sessionStorage: globalThis.sessionStorage, CustomEvent: globalThis.CustomEvent };
  const events = [];
  let panel = null, enabled = false, throws = false;
  globalThis.document = { querySelector: () => panel };
  globalThis.window = { location: { pathname: "/estoque" }, dispatchEvent: (event) => events.push(event) };
  globalThis.sessionStorage = { getItem() { if (throws) throw Error("storage disabled"); return enabled ? "1" : null; } };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  try {
    recordPhotoPerformance("resolver_response", performance.now(), false);
    panel = {}; recordPhotoPerformance("resolver_response", performance.now(), false);
    enabled = true; throws = true; recordPhotoPerformance("resolver_response", performance.now(), false);
    assert.equal(events.length, 0);
    throws = false; recordPhotoPerformance("image_load", performance.now(), true);
    assert.equal(events.length, 1);
    assert.deepEqual(Object.keys(events[0].detail).sort(), ["durationMs", "phase", "reused", "route"]);
    assert.equal(events[0].detail.route, "/estoque");
  } finally { Object.assign(globalThis, old); }
});
