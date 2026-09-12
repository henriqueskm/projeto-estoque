import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  completeAssistantCameraCapture,
  createAssistantCameraPreviewStore,
  isAssistantCameraRequestCurrent,
  runAssistantCameraRequest,
} from "../lib/assistant-camera-lifecycle.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a câmera integrada preserva câmera traseira, JPEG e fallbacks nativos", () => {
  const camera = read("components/assistant-camera-capture.tsx");
  const home = read("components/assistant-home.tsx");

  assert.match(camera, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(camera, /facingMode:\s*\{ ideal: "environment" \}/);
  assert.match(camera, /audio:\s*false/);
  assert.match(camera, /autoPlay/);
  assert.match(camera, /playsInline/);
  assert.match(camera, /canvas\.toBlob\(/);
  assert.match(camera, /"image\/jpeg", 0\.92/);
  assert.match(home, /<AssistantCameraCapture/);
  assert.match(home, /prepareSelectedImage\(file, "camera"\)/);
  assert.match(home, /capture="environment"/);
  assert.doesNotMatch(camera, /fetch\(|\/api\/assistant/);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeStream(name, stoppedTracks) {
  return {
    getTracks: () => [
      { stop: () => stoppedTracks.push(`${name}-main`) },
      { stop: () => stoppedTracks.push(`${name}-secondary`) },
    ],
  };
}

function createCameraHarness() {
  let generation = 0;
  let mounted = true;
  let open = true;
  let hidden = false;
  let published = null;
  let live = null;

  function isCurrent(requestGeneration) {
    return isAssistantCameraRequestCurrent({
      isMounted: mounted,
      isOpen: open,
      isCurrent: requestGeneration === generation,
      isHidden: hidden,
    });
  }

  return {
    start(acquire, play = async () => undefined) {
      generation += 1;
      const requestGeneration = generation;
      const result = runAssistantCameraRequest({
        acquire,
        isCurrent: () => isCurrent(requestGeneration),
        publish(stream) {
          published = stream;
          return true;
        },
        play,
        unpublish(stream) {
          if (published === stream) published = null;
        },
      });
      void result.then((outcome) => {
        if (outcome.status === "active" && isCurrent(requestGeneration)) {
          live = published;
        }
      });
      return result;
    },
    invalidate(reason) {
      generation += 1;
      if (reason === "close") open = false;
      if (reason === "unmount") mounted = false;
      if (reason === "hidden") hidden = true;
      if (published) {
        published.getTracks().forEach((track) => track.stop());
        published = null;
      }
      live = null;
    },
    currentGeneration: () => generation,
    isCurrent,
    published: () => published,
    live: () => live,
  };
}

test("requisição invalidada antes de resolver encerra todos os tracks e nunca ativa", async () => {
  for (const reason of ["hidden", "close", "unmount"]) {
    const acquisition = deferred();
    const stopped = [];
    const harness = createCameraHarness();
    const request = harness.start(() => acquisition.promise);
    harness.invalidate(reason);
    acquisition.resolve(fakeStream(reason, stopped));
    assert.deepEqual(await request, { status: "stale" });
    assert.deepEqual(stopped, [`${reason}-main`, `${reason}-secondary`]);
    assert.equal(harness.live(), null);
  }
});

test("A e B fora de ordem descartam A e preservam B", async () => {
  const acquisitionA = deferred();
  const acquisitionB = deferred();
  const stoppedA = [];
  const stoppedB = [];
  const streamA = fakeStream("a", stoppedA);
  const streamB = fakeStream("b", stoppedB);
  const harness = createCameraHarness();
  const requestA = harness.start(() => acquisitionA.promise);
  const requestB = harness.start(() => acquisitionB.promise);

  acquisitionB.resolve(streamB);
  assert.deepEqual(await requestB, { status: "active" });
  acquisitionA.resolve(streamA);
  assert.deepEqual(await requestA, { status: "stale" });
  await Promise.resolve();
  assert.deepEqual(stoppedA, ["a-main", "a-secondary"]);
  assert.deepEqual(stoppedB, []);
  assert.equal(harness.published(), streamB);
  assert.equal(harness.live(), streamB);
});

test("play pendente invalidado encerra o stream sem voltar para live", async () => {
  const play = deferred();
  const stopped = [];
  const stream = fakeStream("play", stopped);
  const harness = createCameraHarness();
  const request = harness.start(async () => stream, () => play.promise);
  await Promise.resolve();
  assert.equal(harness.published(), stream);
  harness.invalidate("close");
  play.resolve();
  assert.deepEqual(await request, { status: "stale" });
  assert.ok(stopped.includes("play-main") && stopped.includes("play-secondary"));
  assert.equal(harness.published(), null);
  assert.equal(harness.live(), null);
});

test("erro antigo não altera a tentativa nova", async () => {
  const acquisitionA = deferred();
  const acquisitionB = deferred();
  const stoppedB = [];
  const streamB = fakeStream("b", stoppedB);
  const harness = createCameraHarness();
  const requestA = harness.start(() => acquisitionA.promise);
  const requestB = harness.start(() => acquisitionB.promise);
  acquisitionB.resolve(streamB);
  assert.deepEqual(await requestB, { status: "active" });
  acquisitionA.reject(new Error("old permission error"));
  assert.deepEqual(await requestA, { status: "stale" });
  assert.equal(harness.live(), streamB);
  assert.deepEqual(stoppedB, []);
});

test("toBlob tardio após close, unmount ou retake não cria preview nem URL", () => {
  for (const reason of ["close", "unmount", "retake"]) {
    const harness = createCameraHarness();
    const captureGeneration = harness.currentGeneration();
    const created = [];
    harness.invalidate(reason);
    const result = completeAssistantCameraCapture({
      blob: new Blob([reason]),
      isCurrent: () => harness.isCurrent(captureGeneration),
      onMissing() { throw new Error("não deveria faltar blob"); },
      onCaptured() { created.push(reason); },
    });
    assert.equal(result, "stale");
    assert.deepEqual(created, []);
  }
});

test("capture, preview, retake e close mantêm create/revoke coerentes", () => {
  const revoked = [];
  const store = createAssistantCameraPreviewStore((url) => revoked.push(url));
  const harness = createCameraHarness();
  let nextUrl = 0;
  const capture = () => completeAssistantCameraCapture({
    blob: new Blob(["foto"]),
    isCurrent: () => harness.isCurrent(harness.currentGeneration()),
    onMissing() { throw new Error("blob esperado"); },
    onCaptured() {
      nextUrl += 1;
      store.replace(`blob:preview-${nextUrl}`);
    },
  });

  assert.equal(capture(), "captured");
  assert.equal(store.currentUrl, "blob:preview-1");
  harness.invalidate("retake");
  store.clear();
  assert.deepEqual(revoked, ["blob:preview-1"]);
  assert.equal(capture(), "captured");
  assert.equal(store.currentUrl, "blob:preview-2");
  harness.invalidate("close");
  store.clear();
  assert.deepEqual(revoked, ["blob:preview-1", "blob:preview-2"]);
  assert.equal(store.currentUrl, null);
});

test("wiring preserva pagehide, fallback físico, retake e commit-safe open ref", () => {
  const camera = read("components/assistant-camera-capture.tsx");
  assert.match(camera, /window\.addEventListener\("pagehide", handlePageHide\)/);
  assert.match(camera, /function retakePhoto\(\)[\s\S]*clearPreview\(\);\s*void startCamera\(\)/);
  assert.match(camera, /function useNativeCameraFallback\(\)[\s\S]*invalidateCameraWork\(\)/);
  assert.match(camera, /function useGalleryFallback\(\)[\s\S]*invalidateCameraWork\(\)/);
  assert.match(camera, /completeAssistantCameraCapture/);
  assert.match(camera, /useLayoutEffect\(\(\) => \{\s*isOpenRef\.current = isOpen/);
});
