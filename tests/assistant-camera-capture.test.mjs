import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  discardAssistantCameraStream,
  isAssistantCameraRequestCurrent,
} from "../lib/assistant-camera-lifecycle.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a câmera integrada usa getUserMedia com preferência traseira e sem áudio", () => {
  const camera = read("components/assistant-camera-capture.tsx");

  assert.match(camera, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(camera, /facingMode:\s*\{ ideal: "environment" \}/);
  assert.match(camera, /audio:\s*false/);
  assert.match(camera, /autoPlay/);
  assert.match(camera, /playsInline/);
  assert.match(camera, /muted/);
  assert.match(camera, /video\.videoWidth === 0 \|\| video\.videoHeight === 0/);
});

test("a captura gera JPEG local, permite revisar e limpa stream e URLs", () => {
  const camera = read("components/assistant-camera-capture.tsx");

  assert.match(camera, /canvas\.toBlob\(/);
  assert.match(camera, /"image\/jpeg", 0\.92/);
  assert.match(camera, /new File\(\[blob\], `pedido-\$\{timestamp\}\.jpg`/);
  assert.match(camera, /Tirar novamente/);
  assert.match(camera, /Usar foto/);
  assert.match(camera, /streamRef\.current\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(camera, /URL\.revokeObjectURL/);
  assert.match(camera, /visibilitychange/);
  assert.match(camera, /const startFrame = window\.requestAnimationFrame/);
  assert.match(camera, /window\.cancelAnimationFrame\(startFrame\)/);
  assert.doesNotMatch(camera, /fetch\(|\/api\/assistant|prepareSupplierOrderPhoto/);
});

test("o composer usa a câmera integrada, preserva fallback nativo e reutiliza o preparo existente", () => {
  const home = read("components/assistant-home.tsx");

  assert.match(home, /<AssistantCameraCapture/);
  assert.match(home, /setIsCameraCaptureOpen\(true\)/);
  assert.match(home, /prepareSelectedImage\(file, "camera"\)/);
  assert.match(home, /prepareSupplierOrderPhoto\(file\)/);
  assert.match(home, /cameraInputRef\.current\?\.click\(\)/);
  assert.match(home, /capture="environment"/);
  assert.match(home, /galleryInputRef\.current\?\.click\(\)/);
});

function fakeStream(stoppedTracks) {
  return {
    getTracks: () => [
      { stop: () => stoppedTracks.push("video-main") },
      { stop: () => stoppedTracks.push("video-secondary") },
    ],
  };
}

const currentVisibleRequest = {
  isMounted: true,
  isOpen: true,
  isCurrent: true,
  isHidden: false,
};

test("descarta todos os tracks quando hidden, fechado ou desmontado antes da permissão resolver", () => {
  for (const status of [
    { ...currentVisibleRequest, isHidden: true },
    { ...currentVisibleRequest, isOpen: false },
    { ...currentVisibleRequest, isMounted: false },
  ]) {
    const stoppedTracks = [];
    assert.equal(discardAssistantCameraStream(fakeStream(stoppedTracks), status), true);
    assert.deepEqual(stoppedTracks, ["video-main", "video-secondary"]);
  }
});

test("duas permissões fora de ordem preservam só a geração atual", () => {
  const staleTracks = [];
  const currentTracks = [];
  assert.equal(discardAssistantCameraStream(fakeStream(staleTracks), {
    ...currentVisibleRequest,
    isCurrent: false,
  }), true);
  assert.equal(
    discardAssistantCameraStream(fakeStream(currentTracks), currentVisibleRequest),
    false,
  );
  assert.deepEqual(staleTracks, ["video-main", "video-secondary"]);
  assert.deepEqual(currentTracks, []);
});

test("erro antigo, hidden ou close durante play não reescrevem a tentativa atual", () => {
  const camera = read("components/assistant-camera-capture.tsx");
  const beforePublication = camera.indexOf("discardAssistantCameraStream(stream");
  const publication = camera.indexOf("streamRef.current = stream");
  const play = camera.indexOf("await video.play()");
  const afterPlay = camera.indexOf("discardAssistantCameraStream(stream", beforePublication + 1);
  const live = camera.indexOf('setState("live")');
  const catchStart = camera.indexOf("} catch (error)");
  const staleErrorGuard = camera.indexOf("isAssistantCameraRequestCurrent", catchStart);
  const fallback = camera.indexOf('setState("fallback")', catchStart);

  assert.ok(beforePublication < publication);
  assert.ok(play < afterPlay && afterPlay < live);
  assert.ok(catchStart < staleErrorGuard && staleErrorGuard < fallback);
  assert.match(camera, /function handleVisibilityChange\(\)[\s\S]*pauseCamera\(\)/);
  assert.match(camera, /const closeCamera[\s\S]*invalidateCameraWork\(\)/);
});

test("pagehide e unmount invalidam trabalho pendente", () => {
  const camera = read("components/assistant-camera-capture.tsx");
  assert.match(camera, /window\.addEventListener\("pagehide", handlePageHide\)/);
  assert.match(camera, /window\.removeEventListener\("pagehide", handlePageHide\)/);
  assert.match(camera, /function handlePageHide\(\) \{\s*pauseCamera\(\)/);
  assert.match(camera, /mountedRef\.current = false;\s*invalidateCameraWork\(\)/);
});

test("preview e fallback param a câmera e retake inicia stream novo", () => {
  const camera = read("components/assistant-camera-capture.tsx");
  const draw = camera.indexOf("context.drawImage");
  const stop = camera.indexOf("stopStream();", draw);
  const toBlob = camera.indexOf("canvas.toBlob", draw);
  const contextFallback = camera.slice(
    camera.indexOf("if (!context)"),
    draw,
  );
  const retake = camera.slice(
    camera.indexOf("function retakePhoto"),
    camera.indexOf("function usePhoto"),
  );

  assert.ok(draw < stop && stop < toBlob);
  assert.match(contextFallback, /invalidateCameraWork\(\)/);
  assert.match(retake, /clearPreview\(\);\s*void startCamera\(\)/);
  assert.doesNotMatch(retake, /streamRef\.current|video\.play/);
});

test("callback tardio de toBlob é descartado antes de criar URL ou atualizar estado", () => {
  const camera = read("components/assistant-camera-capture.tsx");
  const callback = camera.slice(camera.indexOf("canvas.toBlob"));
  const guard = callback.indexOf("isAssistantCameraRequestCurrent");
  assert.ok(guard >= 0);
  assert.ok(guard < callback.indexOf("URL.createObjectURL"));
  assert.ok(guard < callback.indexOf("setCapturedFile"));
  assert.equal(isAssistantCameraRequestCurrent({
    ...currentVisibleRequest,
    isCurrent: false,
  }), false);
});
