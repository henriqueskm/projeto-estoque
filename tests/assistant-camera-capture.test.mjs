import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
