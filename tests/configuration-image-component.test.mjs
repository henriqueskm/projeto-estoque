import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createConfigurationImageResource } from "../lib/configuration-image-resource.ts";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const changed = (left, right) => !left || left.some((value, index) => !Object.is(value, right[index]));
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function find(tree, predicate) { return nodes(tree).find(predicate); }

function harness(file, props, imports = {}) {
  const slots = [], listeners = new Map(), calls = [];
  let cursor = 0, effects = [], tree, focus = null;
  const old = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const document = {
    body: {}, activeElement: null,
    querySelector(selector) {
      return find(tree, (node) => selector.includes("commercial-image") && node.props?.["data-commercial-image-dialog"] === "true");
    },
    addEventListener(type, callback) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
  };
  globalThis.document = document;
  globalThis.window = { requestAnimationFrame(callback) { callback(); } };
  globalThis.fetch = (url, options) => new Promise((resolve) => { calls.push({ url, options, resolve }); });
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (value) => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useId() { return `id-${cursor++}`; },
    useMemo(callback, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: callback() }; return slots[index].value; },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const index = cursor++;
      if (changed(slots[index]?.deps, deps)) {
        effects.push({ index, callback });
        slots[index] = { deps, cleanup: slots[index]?.cleanup };
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const requireMock = (specifier) => {
    if (imports[specifier]) return imports[specifier];
    if (specifier === "react") return hooks;
    if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (specifier === "react-dom") return { createPortal: (node) => node };
    if (specifier === "@/components/icons") return { EyeIcon: "eye" };
    if (specifier === "@/lib/use-document-scroll-lock") return { useDocumentScrollLock() {} };
    if (specifier === "@/lib/configuration-image-resource") return { createConfigurationImageResource };
    if (specifier === "@/lib/photo-performance-audit") return { recordPhotoPerformance() {} };
    throw Error(specifier);
  };
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)(requireMock, compiled, compiled.exports);
  const Component = Object.values(compiled.exports)[0];
  function render() {
    cursor = 0; effects = []; tree = Component(props);
    for (const node of nodes(tree)) {
      if (!node.props?.ref) continue;
      node.props.ref.current = {
        focus() { focus = node; document.activeElement = this; },
        querySelectorAll() { return nodes(node).filter((element) => element.type === "button").map((element) => element.props.ref?.current ?? { focus() { focus = element; }, offsetParent: {} }); },
      };
    }
    for (const { index, callback } of effects) { slots[index].cleanup?.(); slots[index].cleanup = callback(); }
    return tree;
  }
  return {
    calls, props,
    get tree() { return tree; }, get focus() { return focus; },
    render,
    focusElement(node) { focus = node; document.activeElement = node; },
    activateFocused() { focus.props.onClick(); render(); },
    click() { find(tree, (node) => node.type === "button" && node.props["aria-haspopup"] === "dialog").props.onClick({ stopPropagation() {} }); render(); },
    close() { find(tree, (node) => node.type === "button" && node.props["aria-label"] === "Fechar foto ampliada").props.onClick(); render(); },
    key(key, shiftKey = false) { let prevented = 0; for (const listener of [...(listeners.get("keydown") ?? [])]) listener({ key, shiftKey, preventDefault() { prevented++; } }); render(); return prevented; },
    async settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); render(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); Object.assign(globalThis, old); },
  };
}
const success = (imageUrl) => ({ ok: true, json: async () => ({ imageUrl, expiresInSeconds: 600 }) });
const photoProps = () => ({ commercialCodes: ["1B", "1D"], configurationId: id, hasImage: true, triggerVariant: "text-link" });

test("componente real abre loading imediatamente; fechar pendente ignora resposta e reabrir reutiliza", async () => {
  const h = harness("components/commercial-configuration-image.tsx", photoProps());
  try {
    h.render(); assert.equal(h.calls.length, 0);
    h.click(); assert.equal(h.calls.length, 1);
    assert.ok(find(h.tree, (node) => node.props?.role === "status"));
    assert.equal(h.focus.props["aria-label"], "Fechar foto ampliada");
    h.close(); h.calls[0].resolve(success("url-one")); await h.settle();
    assert.equal(find(h.tree, (node) => node.props?.role === "dialog"), undefined);
    h.click(); await h.settle();
    assert.equal(h.calls.length, 1);
    assert.equal(find(h.tree, (node) => node.type === "img").props.src, "url-one");
    h.key("Escape");
    assert.equal(find(h.tree, (node) => node.props?.role === "dialog"), undefined);
    assert.equal(h.focus.props["aria-haspopup"], "dialog");
    h.click(); await h.settle();
    const dialog = find(h.tree, (node) => node.props?.role === "dialog");
    dialog.props.onMouseDown({ target: dialog, currentTarget: dialog }); h.render();
    assert.equal(find(h.tree, (node) => node.props?.role === "dialog"), undefined);
  } finally { h.dispose(); }
});
test("erro resolver/retry, erro img/refresh e URL expirada executam nova resolução", async () => {
  const originalNow = Date.now; let now = 1000; Date.now = () => now;
  const h = harness("components/commercial-configuration-image.tsx", photoProps());
  try {
    h.render(); h.click();
    h.calls[0].resolve({ ok: false, json: async () => ({}) }); await h.settle();
    assert.ok(find(h.tree, (node) => node.props?.role === "alert"));
    find(h.tree, (node) => node.type === "button" && node.props.children === "Tentar novamente").props.onClick(); h.render();
    assert.equal(h.calls.length, 2);
    h.calls[1].resolve(success("url-two")); await h.settle();
    find(h.tree, (node) => node.type === "img").props.onError(); h.render();
    find(h.tree, (node) => node.type === "button" && node.props.children === "Tentar novamente").props.onClick(); h.render();
    assert.equal(h.calls.length, 3);
    h.calls[2].resolve(success("url-three")); await h.settle(); h.close();
    now += 541_000; h.click();
    assert.ok(find(h.tree, (node) => node.props?.role === "status"));
    assert.equal(h.calls.length, 4);
    h.calls[3].resolve(success("url-four")); await h.settle();
    assert.equal(find(h.tree, (node) => node.type === "img").props.src, "url-four");
  } finally { h.dispose(); Date.now = originalNow; }
});
test("mudança de identidade ignora resposta anterior e não exibe foto de outra configuração", async () => {
  const h = harness("components/commercial-configuration-image.tsx", photoProps());
  try {
    h.render(); h.click(); h.props.configurationId = otherId; h.render();
    assert.equal(h.calls.length, 2);
    h.calls[0].resolve(success("wrong-old")); await h.settle();
    assert.equal(find(h.tree, (node) => node.type === "img"), undefined);
    h.calls[1].resolve(success("correct-new")); await h.settle();
    assert.equal(find(h.tree, (node) => node.type === "img").props.src, "correct-new");
  } finally { h.dispose(); }
});
test("retry ativado pelo teclado mantém foco no botão Fechar enquanto recarrega", async () => {
  for (const failure of ["resolver", "image"]) {
    const h = harness("components/commercial-configuration-image.tsx", photoProps());
    try {
      h.render(); h.click();
      h.calls[0].resolve(failure === "resolver"
        ? { ok: false, json: async () => ({}) }
        : success("first-url"));
      await h.settle();
      if (failure === "image") {
        find(h.tree, (node) => node.type === "img").props.onError();
        h.render();
      }
      const retry = find(h.tree, (node) => node.type === "button" && node.props.children === "Tentar novamente");
      h.focusElement(retry);
      // Native keyboard activation of a focused button invokes its onClick.
      h.activateFocused();
      assert.equal(h.focus.props["aria-label"], "Fechar foto ampliada", failure);
      assert.equal(find(h.tree, (node) => node.type === "button" && node.props.children === "Tentar novamente"), undefined);
      assert.ok(find(h.tree, (node) => node.props?.role === "status"));
      assert.equal(h.calls.length, 2);
      h.key("Escape");
      assert.equal(h.focus.props["aria-haspopup"], "dialog");
      assert.equal(find(h.tree, (node) => node.props?.role === "dialog"), undefined);
    } finally { h.dispose(); }
  }
});
test("thumbnail URL-ready continua renderizando imediatamente sem resolver", () => {
  const h = harness("components/commercial-configuration-image.tsx", { commercialCodes: ["1B"], imageUrl: "ready-thumbnail" });
  try { h.render(); assert.equal(find(h.tree, (node) => node.type === "img").props.src, "ready-thumbnail"); assert.equal(h.calls.length, 0); } finally { h.dispose(); }
});
test("seletor de kit multi-opção monta somente controles com identidades/aliases corretos", () => {
  const Image = function CommercialConfigurationImage() {};
  const option = { configurationId: id, commercialCodes: ["1B", "1D"], servoCode: "2", servoDescription: "Servo", servoModel: "MBF-025", installationKitCode: "KT-18", description: "Caixa", hasImage: true };
  const h = harness("components/compatible-kit-images.tsx", { kitCode: "KT-18", options: [option, { ...option, configurationId: otherId, commercialCodes: ["3A"] }] }, { "@/components/commercial-configuration-image": { CommercialConfigurationImage: Image } });
  try {
    h.render(); h.click();
    assert.equal(h.calls.length, 0);
    const controls = nodes(h.tree).filter((node) => node.type === Image);
    assert.equal(controls.length, 2);
    assert.deepEqual(controls[0].props.commercialCodes, ["1B", "1D"]);
    assert.equal(controls[0].props.configurationId, id);
    assert.equal(controls[1].props.configurationId, otherId);
    assert.equal(controls[0].props.imageUrl, undefined);
    // Simulate the nested photo portal while the selector's real listener runs.
    const children = h.tree.props.children;
    h.tree.props.children = [...children, { type: "div", props: { "data-commercial-image-dialog": "true" } }];
    assert.equal(h.key("Tab"), 0, "selector must leave focus trapping to the photo");
    h.tree.props.children = [...h.tree.props.children, { type: "div", props: { "data-commercial-image-dialog": "true" } }];
    h.key("Escape");
    assert.ok(find(h.tree, (node) => node.props?.["data-compatible-kit-images-dialog"] === "true"));
    h.key("Escape");
    assert.equal(find(h.tree, (node) => node.props?.role === "dialog"), undefined);
  } finally { h.dispose(); }
});
