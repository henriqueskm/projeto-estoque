import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { readFileSync } from "node:fs";

// Execute the real Server Action and login page with only network/navigation
// boundaries stubbed. No real account, credentials or remote mutations.
const require = createRequire(import.meta.url);
const mocks = {
  "next/navigation": `export const RedirectType={replace:'replace',push:'push'};
    export function redirect(location,type='replace'){throw Object.assign(new Error('redirect'),{location,type})}`,
  "@/lib/supabase/server": `export async function createClient(){return fixture.client}`,
  "@/components/brand-mark": `export function BrandMark(){return null}`,
  "./login-form": `export function LoginForm(){return null}`,
};
const bundle = await build({
  stdin: { contents: `export {login,logout} from './app/auth/actions'; export {default as LoginPage} from './app/login/page';`, resolveDir: process.cwd() },
  bundle: true, write: false, format: "cjs", platform: "node", packages: "external", jsx: "automatic",
  plugins: [{ name: "auth-boundaries", setup(builder) {
    builder.onResolve({ filter: /^(next\/navigation|@\/|\.\/login-form$)/ }, args =>
      args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "js" }));
  } }],
});
function setup({ claims = { sub: "sanitized-user" }, claimsError = null, profile = { id: "sanitized-user" }, profileError = null, signInError = null } = {}) {
  const calls = [];
  const client = {
    auth: {
      getClaims: async () => ({ data: { claims }, error: claimsError }),
      signInWithPassword: async () => ({ data: { user: signInError ? null : { id: "sanitized-user" } }, error: signInError }),
      signOut: async options => { calls.push({ operation: "signOut", options }); },
    },
    from(table) {
      calls.push({ operation: "select", table });
      const query = { select: () => query, eq: (key, value) => { calls.push({ key, value }); return query; }, maybeSingle: async () => ({ data: profile, error: profileError }) };
      return query;
    },
  };
  const fixtureModule = { exports: {} };
  new Function("require", "module", "exports", "fixture", bundle.outputFiles[0].text)(require, fixtureModule, fixtureModule.exports, { client });
  const api = fixtureModule.exports;
  function access() {
    const tree = api.LoginPage({ searchParams: Promise.resolve({}) });
    function find(element) {
      if (!element || typeof element !== "object") return null;
      if (element.type?.name === "LoginAccess") return element;
      for (const child of [element.props?.children].flat(Infinity)) { const result = find(child); if (result) return result; }
      return null;
    }
    const element = find(tree);
    assert.ok(element, "request auth gate remains behind Suspense");
    return element.type(element.props);
  }
  return { ...api, access, calls };
}
function form() {
  const data = new FormData();
  data.set("email", "fixture@example.invalid"); data.set("password", "local-fixture-only");
  return data;
}
test("successful active login replaces /login instead of adding it behind the PWA", async () => {
  const f = setup();
  await assert.rejects(f.login({}, form()), error => error.location === "/" && error.type === "replace");
  assert.ok(f.calls.some(call => call.key === "is_active" && call.value === true));
  assert.equal(f.calls.some(call => call.operation === "signOut"), false);
});
test("active authenticated direct /login redirects home without logout", async () => {
  const f = setup();
  await assert.rejects(f.access(), error => error.location === "/" && error.type === "replace");
  assert.equal(f.calls.some(call => call.operation === "signOut"), false);
});
for (const [name, options] of [
  ["anonymous", { claims: null }], ["invalid claims", { claimsError: { message: "fixture" } }],
  ["inactive/missing profile", { profile: null }], ["profile read failure", { profileError: { message: "fixture" } }],
]) test(`${name}: /login remains usable, no login ↔ home loop`, async () => {
  const f = setup(options); assert.ok(await f.access());
  assert.equal(f.calls.some(call => call.operation === "signOut"), false);
});
test("inactive login preserves the existing authorization rejection", async () => {
  const f = setup({ profile: null }); const result = await f.login({}, form());
  assert.match(result.error, /inativo/); assert.equal(f.calls.filter(call => call.operation === "signOut").length, 1);
});
test("explicit logout still signs out locally and goes to login; never cleans push", async () => {
  const f = setup(); await assert.rejects(f.logout(), error => error.location === "/login");
  assert.deepEqual(f.calls, [{ operation: "signOut", options: { scope: "local" } }]);
  const source = readFileSync(new URL("../app/auth/actions.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /push-subscriptions|prepareForLogout|unregister|disable_push_subscription/);
});
test("exit implementation has no auth/push/storage cleanup or programmatic navigation", () => {
  const source = readFileSync(new URL("../lib/semantic-back-history.ts", import.meta.url), "utf8");
  const leave = source.slice(source.indexOf("leaveApp()"), source.indexOf("dispose()"));
  assert.doesNotMatch(leave, /history\.go|signOut|localStorage|sessionStorage|fetch\(|window\.close|location\s*=/);
});
