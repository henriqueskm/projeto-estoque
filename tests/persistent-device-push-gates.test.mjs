import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Real structured chat renderer, alert provider, sidebar and account page.
// Stub only navigation/remote boundaries; never call Supabase or activate push.
const require = createRequire(import.meta.url);
const mocks = {
  "next/navigation": `export function usePathname(){return '/minha-conta'}
    export function useSearchParams(){return new URLSearchParams()}
    export function useRouter(){return {prefetch(){},refresh(){}}}`,
  "next/link": `import {createElement} from 'react';export default function Link({children,prefetch,onClick,...props}){
    if(props.href==='/minha-conta')fixture.links.push({...props,onClick});return createElement('a',props,children)}`,
  "next/server": `export async function connection(){fixture.calls.push('connection');await fixture.connection}`,
  "@/lib/auth": `export async function requireActiveProfile(){fixture.calls.push('profile');return {displayName:'Fixture',email:'fixture@example.invalid',hasRegisteredName:true}}`,
  "@/components/workspace-state-provider": `export function useWorkspaceResumeHref(href){return href}export function useWorkspaceResumeResolver(){return href=>href}`,
  "@/components/semantic-back-provider": `export function useSemanticTransient(){}`,
  "@/components/push-aware-logout-form": `export function PushAwareLogoutForm(){return null}`,
  "@/components/push-notification-control": `export function PushNotificationControl(){return null}`,
  "@/components/safisa-pickup-alerts": `export function SafisaPickupAlertBell(){return null}`,
  "@/components/safisa-bulk-pickup-dialog": `import {createElement} from 'react';export function SafisaBulkPickupAction({enabled}){
    fixture.enabled.push(enabled);return enabled?createElement('button',null,'Retirar todos os prontos'):null}`,
  "@/components/commercial-configuration-image": `export function CommercialConfigurationImage(){return null}`,
  "@/components/compatible-kit-images": `export function CompatibleKitImages(){return null}`,
};
const bundle = await build({
  stdin: { resolveDir: process.cwd(), contents: `export {AppSidebar} from './components/app-sidebar';
    export {AssistantStructuredBlockView} from './components/assistant-structured-block';
    export {SafisaPickupAlertProvider} from './components/safisa-pickup-alert-provider';
    export {default as AccountPage} from './app/(authenticated)/minha-conta/page';` },
  bundle: true, write: false, format: "cjs", platform: "node", packages: "external", jsx: "automatic",
  plugins: [{ name: "read-only-gate-boundaries", setup(builder) {
    builder.onResolve({ filter: /^(next\/|@\/)/ }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "js", resolveDir: process.cwd() }));
  } }],
});
function setup(connection = Promise.resolve()) {
  const fixture = { links: [], enabled: [], calls: [], connection };
  const fixtureModule = { exports: {} };
  new Function("require", "module", "exports", "fixture", bundle.outputFiles[0].text)(require, fixtureModule, fixtureModule.exports, fixture);
  return { ...fixtureModule.exports, fixture };
}
const block = {
  kind: "assistant_attention_orders", alertKind: "SAFISA_READY_PICKUP", title: "Itens prontos na Safisa", summary: "17 prontas (snapshot antigo)",
  remainingCount: 0, orders: [{supplierOrderId:"85000000-0000-4000-8000-000000000020",negotiationNumber:"40959",quantity:17,href:"/pedidos?order=85000000-0000-4000-8000-000000000020"}],
};
function chat(f, initialResult) {
  return renderToStaticMarkup(createElement(f.SafisaPickupAlertProvider, { initialResult }, createElement(f.AssistantStructuredBlockView, { block })));
}
test("old chat with positive quantity follows actual provider zero → pickup, not its historical snapshot", () => {
  const f = setup();
  const data = { alerts: [], alertCount: 0, isComplete: true };
  const empty = chat(f, { data, error: null });
  assert.match(empty, /17/); assert.doesNotMatch(empty, /Retirar todos os prontos/);
  const live = chat(f, { data: { ...data, alertCount: 1 }, error: null });
  assert.match(live, /Retirar todos os prontos/);
  assert.deepEqual(f.fixture.enabled, [false, true], "action stays rendered with enabled=false, preserving its uncertain attempt owner");
});
test("unknown/failed current alerts fail closed even with a positive historical block", () => {
  const f = setup();
  assert.doesNotMatch(chat(f), /Retirar todos os prontos/);
  assert.doesNotMatch(chat(f, {data:{alerts:[],alertCount:1,isComplete:true},error:"unavailable"}), /Retirar todos os prontos/);
  assert.deepEqual(f.fixture.enabled, [false, false]);
});
for (const surface of ["desktop", "mobile drawer"]) {
  test(`Minha Conta same-route on ${surface}: real shared link prevents navigation and is marked current`, () => {
    const f = setup(); renderToStaticMarkup(createElement(f.AppSidebar, {userName:"Fixture",hasRegisteredName:true}));
    assert.ok(f.fixture.links.length > 0);
    for (const link of f.fixture.links) {
      assert.equal(link["aria-current"], "page"); assert.equal(link["data-nk-navigation"], true);
      let prevented = false;
      link.onClick({button:0,preventDefault(){prevented=true;}});
      assert.equal(prevented, true);
      let modified = false;
      link.onClick({button:0,ctrlKey:true,preventDefault(){modified=true;}});
      assert.equal(modified, false, "modified/new-tab click remains a normal link");
    }
  });
}
test("Account page does not start profile/fetch work until a real connection resolves", async () => {
  let connect; const f = setup(new Promise(resolve => { connect = resolve; }));
  const page = f.AccountPage();
  await Promise.resolve(); assert.deepEqual(f.fixture.calls, ["connection"]);
  connect(); const html = renderToStaticMarkup(await page);
  assert.deepEqual(f.fixture.calls, ["connection", "profile"]); assert.match(html, /Minha conta/);
});
