// Run only against tests/persistent-device-push.visual.mjs, with local CLI:
// npx --no-install playwright-cli -s=nk85 run-code --filename=tests/persistent-device-push.smoke.js
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- CLI requires a bare function expression, not an exported module.
async (page) => {
  if (!page.url().startsWith("http://127.0.0.1:3085/")) throw Error("Local fixture only");
  const errors = [];
  const failures = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", request => failures.push(request.url()));
  const check = (condition, description) => { if (!condition) throw Error(description); };
  const metrics = () => page.evaluate(() => ({
    posts: window.__posts, deletes: window.__deletes, unregisters: window.__unregisters,
    permissions: window.__permissionRequests, enabled: window.__subscription?.enabled,
    owner: window.__subscription?.userId, preference: localStorage.getItem("negocios-k:push-preference"),
    navs: window.__navs, before: window.__beforeNavigation, previewReads: window.__previewReads,
  }));
  const results = [];
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:3085/estoque");
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
    const account = page.getByRole("region", { name: "Minha Conta (fixture)" });
    const bell = page.getByRole("region", { name: "Sino (fixture)" });
    await account.getByRole("button", { name: "Ativar notificações" }).waitFor();
    await bell.getByRole("button", { name: "Ativar notificações" }).click();
    await account.getByRole("button", { name: "Desativar notificações" }).waitFor();
    check(await bell.textContent() === "", "Active bell must hide its entire control");
    const activated = await metrics();
    check(activated.posts === 1 && activated.permissions === 1 && activated.enabled, "Activation must persist exactly once");
    await page.getByRole("button", { name: "Logout (fixture)" }).click();
    await page.getByRole("button", { name: "Login A (fixture)" }).waitFor();
    check(JSON.stringify(await metrics()) === JSON.stringify(activated), "Logout changed push state");
    await page.getByRole("button", { name: "Login A (fixture)" }).click();
    await account.getByRole("button", { name: "Desativar notificações" }).waitFor();
    check(JSON.stringify(await metrics()) === JSON.stringify(activated), "Relogin duplicated registration or requested permission");
    check(await bell.textContent() === "", "Bell must remain hidden after relogin");
    await account.getByRole("button", { name: "Desativar notificações" }).click();
    await account.getByRole("button", { name: "Ativar notificações" }).waitFor();
    const disabled = await metrics();
    check(!disabled.enabled && disabled.deletes === 1 && disabled.unregisters === 1 && disabled.preference === "disabled", "Explicit disable must clean up");
    await page.getByRole("button", { name: "Logout (fixture)" }).click();
    await page.getByRole("button", { name: "Login A (fixture)" }).click();
    await account.getByRole("button", { name: "Ativar notificações" }).waitFor();
    check((await metrics()).preference === "disabled" && !(await metrics()).enabled, "Disabled preference resurrected");
    await account.getByRole("button", { name: "Ativar notificações" }).click();
    await account.getByRole("button", { name: "Desativar notificações" }).waitFor();
    const reenabled = await metrics();
    check(reenabled.posts === 2 && reenabled.permissions === 1 && reenabled.enabled, "Explicit reactivation failed");
    await page.getByRole("button", { name: "Logout (fixture)" }).click();
    await page.getByRole("button", { name: "Login B (fixture)" }).click();
    await account.getByRole("button", { name: "Ativar notificações" }).waitFor();
    check((await metrics()).posts === 2 && (await metrics()).owner.endsWith("001"), "B login reassociated A automatically");
    await account.getByRole("button", { name: "Ativar notificações" }).click();
    await account.getByRole("button", { name: "Desativar notificações" }).waitFor();
    check((await metrics()).posts === 3 && (await metrics()).owner.endsWith("002"), "B explicit activation failed to use canonical writer");
    await page.getByRole("button", { name: "Aplicar filtro (fixture)" }).click();
    await page.getByText("Filtro atual: low", { exact: true }).waitFor();
    const checkpointBeforeDrawer = await page.evaluate(() => history.state?.__nkSemanticBack?.id);
    if (width < 1024) {
      await page.getByRole("button", { name: "Abrir menu principal" }).click();
      await page.getByRole("dialog").waitFor();
    }
    const beforeCurrentTab = await metrics();
    await page.getByRole("link", { name: "Estoque", exact: true }).filter({ visible: true }).click();
    if (width < 1024) await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.waitForFunction(id => history.state?.__nkSemanticBack?.id === id, checkpointBeforeDrawer);
    check(await page.getByText("Filtro atual: low", { exact: true }).isVisible(), "Same tab acted as Back on the underlying filter");
    check((await metrics()).navs === beforeCurrentTab.navs && (await metrics()).before === beforeCurrentTab.before,
      "Same tab triggered route navigation/workspace cleanup");
    await page.getByRole("button", { name: "Mostrar itens prontos na safisa no chat" }).click();
    await page.getByText("Pedido 40959", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Zerar alertas (fixture)" }).click();
    await page.getByRole("button", { name: "Retirar todos os prontos" }).waitFor({ state: "hidden" });
    check(await page.getByText("Pedido 40959", { exact: true }).isVisible(), "Old chat must remain while live CTA hides");
    await page.getByRole("button", { name: "Restaurar alertas (fixture)" }).click();
    await page.getByRole("button", { name: "Retirar todos os prontos" }).waitFor();
    await page.getByRole("button", { name: "Retirar todos os prontos" }).click();
    await page.getByRole("heading", { name: "Prévia da retirada Safisa" }).waitFor();
    check((await metrics()).previewReads === 1, "Chat bulk must fetch fresh preview");
    check(await page.getByText("SERVO MODELO SANITIZADO", { exact: true }).isVisible(), "Preview line missing");
    check(await page.getByRole("button", { name: "Confirmar retirada + entrada" }).isVisible(), "Confirmation boundary missing");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check(!overflow, `Horizontal overflow at ${width}px`);
    await page.keyboard.press("Escape");
    await page.getByRole("heading", { name: "Prévia da retirada Safisa" }).waitFor({ state: "hidden" });
    results.push({ width, pushCycle: "passed", sameTab: "passed", chatPreviewReadOnly: "passed", overflow: false });
  }
  check(errors.length === 0 && failures.length === 0, JSON.stringify({ errors, failures }));
  return { results, consoleErrors: errors.length, failedRequests: failures.length, remoteMutations: 0,
    limitation: "Real components; auth, Firebase and API are simulated locally. No real delivery/device permission claim." };
}
