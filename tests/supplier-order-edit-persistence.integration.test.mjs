import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { updateSupplierOrder } from "../app/(authenticated)/pedidos/actions.ts";
import { buildSupplierOrderFormLines } from "../lib/supplier-order-form-lines.ts";

// Real Server Action + payload builder + PostgreSQL public RPC + fresh reads.
// Only Next transport/cache and Supabase HTTP transport are bridged locally;
// auth/profile/RLS/transaction/idempotency still execute in PostgreSQL.
const container = "supabase_db_nk_issue91", database = "nk91_test", actor = "91000000-0000-4000-8000-000000000001";
const run = args => execFileSync("docker", args, { encoding: "utf8", windowsHide: true });
assert.equal(JSON.parse(run(["inspect", "-f", "{{json .Config.Labels}}", container]))["nk.disposable"], "nk-issue91");
assert.equal(run(["inspect", "-f", "{{.HostConfig.NetworkMode}}", container]).trim(), "none");
const sql = text => run(["exec", container, "psql", "-U", "postgres", "-d", database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", text]).trim();
const quote = value => value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const asUser = statement => sql(`begin; select set_config('request.jwt.claim.sub','${actor}',true); set local role authenticated; ${statement}; commit;`);
const parsed = output => JSON.parse(output.split(/\r?\n/).findLast(line => line.startsWith("{")));
const item = sql("select id from public.items where item_type='SERVO' and is_active order by code limit 1");
const repair = sql("select id from public.items where item_type='REPAIR_KIT' and is_active order by code limit 1");
const code = JSON.parse(sql("select jsonb_build_object('id',id,'configuration',configuration_id) from public.commercial_configuration_codes where is_active order by code limit 1"));
const key = "91000000-0000-4000-8000-000000000070";
let original, rows, sent;
test.beforeEach(() => {
  sql(`truncate public.supplier_orders cascade; insert into auth.users(id,aud,role) values('${actor}','authenticated','authenticated') on conflict(id) do nothing;
    insert into public.profiles(id,name,is_active) values('${actor}','Integration Fixture',true) on conflict(id) do update set name=excluded.name,is_active=true;`);
  original = parsed(asUser(`select public.create_supplier_order('919191','2026-10-20',null,
    '[{"kind":"ITEM","item_id":"${item}","quantity":5}]','91000000-0000-4000-8000-000000000071')`));
  rows = JSON.parse(sql(`select jsonb_agg(l order by position) from public.supplier_order_items l where supplier_order_id='${original.supplier_order_id}'`));
  sent = []; globalThis.__nk57RevalidatedPaths = []; globalThis.__nk57Pushes = [];
  globalThis.__nk57SupabaseClient = {
    auth: { getClaims: async () => ({ data: { claims: { sub: actor } } }) },
    from(table) {
      let id;
      const query = { select() { return query; }, eq(field, value) { if (field === "id") id = value; return query; },
        async maybeSingle() {
          assert.ok(["profiles", "supplier_orders"].includes(table));
          const statement = table === "profiles"
            ? `select jsonb_build_object('id',id,'name',name) from public.profiles where id=${quote(id)} and is_active`
            : `select jsonb_build_object('id',o.id,'negotiation_number',o.negotiation_number,'order_date',o.order_date,'notes',o.notes,
                'supplier_order_items',(select jsonb_agg(l order by position) from public.supplier_order_items l where supplier_order_id=o.id))
              from public.supplier_orders o where o.id=${quote(id)}`;
          return { data: parsed(asUser(statement)), error: null };
        } };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, "update_supplier_order"); sent.push(args);
      const values = [args.p_supplier_order_id,args.p_expected_updated_at,args.p_negotiation_number,args.p_order_date,args.p_notes,
        JSON.stringify(args.p_lines),args.p_idempotency_key];
      return { data: parsed(asUser(`select public.update_supplier_order(${values.map(quote).join(",")})`)), error: null };
    },
  };
});
const formLine = patch => ({ existingId: null, kind: "ITEM", itemId: repair, configurationId: null, commercialCodeId: null,
  quantity: 2, notes: "", readyQuantity: 0, pickedQuantity: 0, cancelledQuantity: 0, ...patch });
const request = () => ({ supplier_order_id: original.supplier_order_id, expected_updated_at: original.updated_at,
  negotiation_number: "919191", order_date: "2026-10-20", notes: "integrated edit", idempotency_key: key,
  lines: buildSupplierOrderFormLines([formLine({ existingId: rows[0].id, itemId: item, quantity: 5 }), formLine({}),
    formLine({ kind: "COMMERCIAL_CONFIGURATION", itemId: null, configurationId: code.configuration, commercialCodeId: code.id, quantity: 3 })]) });
test.afterEach(() => { delete globalThis.__nk57SupabaseClient; });

test("actual form payload -> Server Action -> PostgreSQL commit -> independent reload/new-session read", async () => {
  const result = await updateSupplierOrder(request()); assert.equal(result.ok, true); assert.equal(result.receipt.lineCount, 3);
  const reloaded = parsed(asUser(`select jsonb_build_object('count',count(*),'quantity',sum(ordered_quantity)) from public.supplier_order_items where supplier_order_id='${original.supplier_order_id}'`));
  assert.deepEqual(reloaded, { count: 3, quantity: 10 }); assert.deepEqual(globalThis.__nk57RevalidatedPaths, ["/pedidos"]);
  assert.equal(sql(`select count(*) from public.supplier_order_events where supplier_order_id='${original.supplier_order_id}' and event_type='ORDER_ITEMS_UPDATED'`), "1");
});
test("retry through the actual action/RPC returns original receipt without new rows/audit", async () => {
  const input = request(), first = await updateSupplierOrder(input), second = await updateSupplierOrder(input);
  assert.equal(first.ok, true); assert.deepEqual(second, first); assert.equal(sent[0].p_idempotency_key, sent[1].p_idempotency_key);
  assert.equal(sql(`select count(*) from public.supplier_order_items where supplier_order_id='${original.supplier_order_id}'`), "3");
  assert.equal(sql(`select count(*) from public.supplier_order_events where supplier_order_id='${original.supplier_order_id}' and event_type='ORDER_ITEMS_UPDATED'`), "1");
});
