import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("notification prompt opens only for devices that have not turned notifications on", () => {
  const prompt = read("components/push-notification-prompt.tsx");

  assert.match(prompt, /usePushNotifications\(\)/);
  assert.match(prompt, /state === "default" \|\| \(wasShown && \(isEnabling \|\| enableFailed\)\)/);
  assert.doesNotMatch(prompt, /state === "granted" \|\|/, "an active device never sees the prompt");
  assert.match(prompt, /!blocked/);
  assert.match(prompt, /negocios-k:push-prompt-dismissed/);
  assert.match(prompt, /useSemanticTransient\(isOpen, dismissForSession, isEnabling\)/);
  assert.match(prompt, /onClick=\{\(\) => void enable\(\)\}/);
  assert.match(prompt, /Agora não/);
});

test("home shows the install prompt first and the notification prompt after it closes", () => {
  const home = read("components/assistant-home.tsx");
  const install = read("components/pwa-install-prompt.tsx");

  assert.match(home, /<PwaInstallPrompt onOpenChange=\{setIsInstallPromptOpen\} \/>/);
  assert.match(home, /<PushNotificationPrompt blocked=\{isInstallPromptOpen\} \/>/);
  assert.match(install, /onOpenChange\?\.\(Boolean\(installMode\)\)/);
});
