// Local sanitized boundaries, real SemanticBackProvider and browser History API.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Playwright CLI requires a single function expression.
async (page) => {
  if (!page.url().startsWith("http://127.0.0.1:3085/")) throw Error("Local fixture only");
  const errors = [], failures = [], results = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", request => failures.push(request.url()));
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const metrics = () => page.evaluate(() => ({ user: window.__userId, logouts: window.__logouts,
    deletes: window.__deletes, unregisters: window.__unregisters, posts: window.__posts,
    enabled: window.__subscription?.enabled, preference: localStorage.getItem("negocios-k:push-preference"),
    historyLength: history.length, url: location.pathname }));
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:3085/login?standalone=1");
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
    await page.getByRole("button", { name: "Login A (fixture)" }).click();
    await page.waitForFunction(() => history.state?.__nkSemanticBack?.kind === "ROUTE");
    const account = page.getByRole("region", { name: "Minha Conta (fixture)" });
    await account.getByRole("button", { name: "Ativar notificações" }).click();
    await account.getByRole("button", { name: "Desativar notificações" }).waitFor();
    const original = await metrics();
    const exit = page.getByRole("dialog", { name: "Sair do Negócios K?" });
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goBack(); await exit.waitFor();
      await exit.getByRole("button", { name: "Continuar no app" }).click();
      await exit.waitFor({ state: "hidden" });
      check(JSON.stringify(await metrics()) === JSON.stringify(original), "Continue changed session/push/URL/history");
    }
    await page.goBack(); await exit.waitFor();
    await page.goBack(); await exit.waitFor({ state: "hidden" });
    check(JSON.stringify(await metrics()) === JSON.stringify(original), "Second Back changed state");
    await page.goBack(); await exit.waitFor();
    await page.keyboard.press("Escape"); await exit.waitFor({ state: "hidden" });
    await page.goBack(); await exit.waitFor();
    await exit.getByRole("button", { name: "Sair", exact: true }).click();
    await exit.waitFor({ state: "hidden" });
    check(JSON.stringify(await metrics()) === JSON.stringify(original), "Exit must not navigate or touch session/push");
    await page.goBack();
    await page.waitForFunction(() => history.state?.__nkSemanticBack?.kind === "EXIT_BOUNDARY");
    check(await exit.count() === 0, "Released boundary trapped next Back");
    check(page.url().endsWith("/"), "Native Back exposed pre-authentication login");
    check(await page.getByRole("button", { name: "Login A (fixture)" }).count() === 0, "Exit performed logout");
    const afterNative = await metrics();
    check(JSON.stringify(afterNative) === JSON.stringify(original), "Release changed persistent state/history length");
    await page.goForward();
    await page.waitForFunction(() => history.state?.__nkSemanticBack?.kind === "ROUTE");
    await page.getByRole("button", { name: "Logout (fixture)" }).click();
    await page.getByRole("button", { name: "Login A (fixture)" }).waitFor();
    const afterLogout = await metrics();
    check(await page.evaluate(() => window.__closeAttempts) === 1, "Explicit Sair must attempt immediate closing even when runtime refuses");
    check(afterLogout.logouts === 1 && afterLogout.url === "/login", "Explicit logout still goes to login");
    check(afterLogout.enabled && afterLogout.deletes === 0 && afterLogout.unregisters === 0 && afterLogout.preference === "enabled", "Explicit logout changed push");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Horizontal overflow");
    results.push({ width, passed: true });
  }
  check(errors.length === 0 && failures.length === 0, JSON.stringify({ errors, failures }));
  return { results, consoleErrors: errors.length, failedRequests: failures.length, physicalAndroid: "not tested; standalone emulated, Auth/FCM mocked" };
}
