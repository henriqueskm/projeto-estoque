import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PhysicalCatalogCategoryDialog, PhysicalCatalogCreateButton, PhysicalCatalogDialog } from "../components/physical-catalog-dialog.tsx";
import { InventoryWorkspace } from "../app/(authenticated)/estoque/inventory-workspace.tsx";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const render = (component, props) => renderToStaticMarkup(h(component, props));
const noop = () => {};

test("Inventory renders exactly one registration button next to Itens avulsos, even with empty groups", () => {
  const html = render(InventoryWorkspace, { inventory: {
    physicalItems: [], configurations: [], bundles: [], physicalCatalogCount: 0, configurationCatalogCount: 0,
    summary: { completeBoxesTotal: 0, looseServoTotal: 0, looseKitTotal: 0, repairKitTotal: 0, loosePartTotal: 0, lowStockItems: 0, outOfStockItems: 0 },
  } });
  assert.equal((html.match(/>Cadastrar produto<\/button>/g) ?? []).length, 1);
  assert.ok(html.indexOf("physical-items-title") < html.indexOf(">Cadastrar produto</button>"));
  assert.doesNotMatch(html, /aria-label="Cadastrar (Servo|Kit|Reparo|Peça)/);
  for (const heading of html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)) {
    assert.equal((heading[1].match(/<button\b/g) ?? []).length, 1);
    assert.doesNotMatch(heading[1], /Cadastrar|>\+</);
    assert.match(heading[1], /aria-expanded=/);
  }
});

test("launcher starts closed without selecting or rendering a category/form", () => {
  const html = render(PhysicalCatalogCreateButton, { servoOptions: [] });
  assert.match(html, /type="button"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /min-h-11 w-full/);
  assert.doesNotMatch(html, /role="dialog"|<form|<input|Servo|Kit|Peça/);
});

test("category selection exposes exactly the four fixed, explicit, keyboard-native choices", () => {
  const html = render(PhysicalCatalogCategoryDialog, { onSelect: noop, onClose: noop });
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby=/);
  for (const label of ["Servo sem kit", "Kit de instalação", "Jogo de reparo", "Peça avulsa"]) {
    assert.equal((html.match(new RegExp(`>${label}</button>`, "g")) ?? []).length, 1);
  }
  assert.equal((html.match(/min-h-14 w-full/g) ?? []).length, 4);
  assert.match(html, />Cancelar<\/button>/);
  assert.doesNotMatch(html, /<form|<input|checked|selected|Conjunto|Servo com kit/);
});

test("category selection is read-only; it only passes the chosen physical type to the existing form", () => {
  const source = read("components/physical-catalog-dialog.tsx");
  const selector = source.slice(source.indexOf("export function PhysicalCatalogCategoryDialog"), source.indexOf("export function PhysicalCatalogCreateButton"));
  assert.match(selector, /onClick=\{\(\) => onSelect\(category\.type\)\}/);
  assert.match(selector, /useAccessibleDialog\(dialogRef, firstOption, false, onClose\)/);
  assert.doesNotMatch(selector, /managePhysicalCatalog|loadPhysicalCatalogPreview|crypto|rpc|fetch\(/);
  assert.match(source, /useState<PhysicalStockItemType \| null>\(null\)/);
  assert.match(source, /open && !selectedType \? <PhysicalCatalogCategoryDialog/);
  assert.match(source, /open && selectedType \? <PhysicalCatalogDialog operation="CREATE" itemType=\{selectedType\}/);
});

test("each selected category reuses the zero-stock form and offers an explicit return before review", () => {
  for (const itemType of ["SERVO", "INSTALLATION_KIT", "REPAIR_KIT", "LOOSE_PART"]) {
    const html = render(PhysicalCatalogDialog, { operation: "CREATE", itemType, onClose: noop, onSuccess: noop, onBack: noop });
    assert.match(html, /Cadastro sem movimentação/);
    assert.match(html, />Voltar às categorias<\/button>/);
    assert.match(html, />Cancelar<\/button>/);
    assert.match(html, /Revisar alteração/);
    assert.doesNotMatch(html, /type="number"|Saldo inicial.*input/);
    assert.equal(html.includes("Modelo do Servo"), itemType === "SERVO");
    assert.equal(html.includes("Compatibilidade com Servos"), itemType === "REPAIR_KIT");
  }
  assert.match(read("components/physical-catalog-dialog.tsx"), /operation === "CREATE" && onBack && !review && !locked/);
});

test("EDIT/ARCHIVE do not acquire category navigation and retain the existing fresh-preview path", () => {
  for (const operation of ["EDIT", "ARCHIVE"]) {
    const html = render(PhysicalCatalogDialog, { operation, itemId: "98000000-0000-4000-8000-000000000001", onClose: noop, onSuccess: noop, onBack: noop });
    assert.doesNotMatch(html, /Voltar às categorias|Qual categoria/);
    assert.match(html, /Carregando prévia atual do servidor/);
  }
});

test("one transient checkpoint closes the entire flow; Activity resets selection and pending blocks Back", () => {
  const source = read("components/physical-catalog-dialog.tsx");
  assert.equal((source.match(/useSemanticTransient\(open, close, pending\)/g) ?? []).length, 1);
  assert.match(source, /const close = useCallback\(\(\) => \{ setOpen\(false\); setSelectedType\(null\); requestAnimationFrame\(\(\) => trigger\.current\?\.focus\(\)\)/);
  assert.match(source, /useRouteTransientCleanup\(\(\) => \{ setOpen\(false\); setSelectedType\(null\); setFeedback\(null\); \}/);
  assert.match(source, /const locked = isPending \|\| uncertain/);
  assert.doesNotMatch(source, /pushState|replaceState|popstate|localStorage/);
});
