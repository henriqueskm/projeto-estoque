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
    const hint = page.getByRole("status").filter({ hasText: "Toque em voltar de novo para sair" });
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goBack(); await hint.waitFor();
      await page.waitForFunction(() => history.state?.__nkSemanticBack?.kind === "EXIT_BOUNDARY");
      check(page.url().endsWith("/"), "Boundary exposed pre-authentication login");
      check(await page.getByRole("button", { name: "Login A (fixture)" }).count() === 0, "Back performed logout");
      const atBoundary = await metrics();
      check(atBoundary.user === original.user && atBoundary.logouts === original.logouts && atBoundary.enabled === original.enabled
        && atBoundary.historyLength === original.historyLength, "Boundary changed session/push/history");
      await page.goForward();
      await page.waitForFunction(() => history.state?.__nkSemanticBack?.kind === "ROUTE");
    }
    await page.getByRole("button", { name: "Logout (fixture)" }).click();
    await page.getByRole("button", { name: "Login A (fixture)" }).waitFor();
    const afterLogout = await metrics();
    check(afterLogout.logouts === 1 && afterLogout.url === "/login", "Explicit logout still goes to login");
    check(afterLogout.enabled && afterLogout.deletes === 0 && afterLogout.unregisters === 0 && afterLogout.preference === "enabled", "Explicit logout changed push");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Horizontal overflow");
    results.push({ width, passed: true });
  }
  check(errors.length === 0 && failures.length === 0, JSON.stringify({ errors, failures }));
  return { results, consoleErrors: errors.length, failedRequests: failures.length, physicalAndroid: "not tested; standalone emulated, Auth/FCM mocked" };
}
