"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CameraIcon, CloseIcon, ImageIcon } from "@/components/icons";
import {
  completeAssistantCameraCapture,
  createAssistantCameraPreviewStore,
  isAssistantCameraRequestCurrent,
  runAssistantCameraRequest,
} from "@/lib/assistant-camera-lifecycle";
import { captureAssistantCameraPhoto } from "@/lib/assistant-camera-photo";

type CameraState = "starting" | "live" | "capturing" | "preview" | "paused" | "fallback";

type PhotoCaptureConstructor = new (track: MediaStreamTrack) => { takePhoto: () => Promise<Blob> };

type AssistantCameraCaptureProps = {
  isOpen: boolean;
  onClose: () => void;
  onUsePhoto: (file: File) => void;
  onNativeCameraFallback: () => void;
  onGalleryFallback: () => void;
};

function cameraMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Permita o acesso à câmera para tirar a foto dentro do NK.";
    }
    if (error.name === "NotFoundError") {
      return "Não encontramos uma câmera disponível neste dispositivo.";
    }
    if (
      error.name === "NotReadableError" ||
      error.name === "OverconstrainedError" ||
      error.name === "AbortError"
    ) {
      return "Não foi possível iniciar a câmera. Você pode usar a câmera do celular ou escolher uma imagem da galeria.";
    }
  }

  return "Não foi possível iniciar a câmera. Você pode usar a câmera do celular ou escolher uma imagem da galeria.";
}

export function AssistantCameraCapture({
  isOpen,
  onClose,
  onUsePhoto,
  onNativeCameraFallback,
  onGalleryFallback,
}: AssistantCameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const requestGenerationRef = useRef(0);
  const captureControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const isOpenRef = useRef(false);
  const [previewStore] = useState(() =>
    createAssistantCameraPreviewStore((url) => URL.revokeObjectURL(url)),
  );
  const [state, setState] = useState<CameraState>("starting");
  const [message, setMessage] = useState("Abrindo câmera...");
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hasVideoDimensions, setHasVideoDimensions] = useState(false);
  const [captureMetadata, setCaptureMetadata] = useState<{
    source: string; videoWidth: number; videoHeight: number; width: number; height: number; bytes: number;
  } | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const invalidateCameraWork = useCallback(() => {
    requestGenerationRef.current += 1;
    captureControllerRef.current?.abort();
    captureControllerRef.current = null;
    stopStream();
  }, [stopStream]);

  const requestStatus = useCallback((requestGeneration: number) => ({
    isMounted: mountedRef.current,
    isOpen: isOpenRef.current,
    isCurrent: requestGeneration === requestGenerationRef.current,
    isHidden: document.visibilityState === "hidden",
  }), []);

  const clearPreview = useCallback(() => {
    previewStore.clear();
    setPreviewUrl(null);
    setCapturedFile(null);
    setCaptureMetadata(null);
  }, [previewStore]);

  const startCamera = useCallback(async () => {
    invalidateCameraWork();
    const requestGeneration = requestGenerationRef.current;

    if (!navigator.mediaDevices?.getUserMedia) {
      setState("fallback");
      setMessage("A câmera integrada não está disponível neste navegador.");
      return;
    }

    setHasVideoDimensions(false);
    setState("starting");
    setMessage("Abrindo câmera...");

    const result = await runAssistantCameraRequest({
      acquire: () => navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 3_840 },
          height: { ideal: 2_160 },
        },
        audio: false,
      }),
      isCurrent: () =>
        isAssistantCameraRequestCurrent(requestStatus(requestGeneration)),
      publish(stream) {
        const video = videoRef.current;
        if (!video) return false;
        streamRef.current = stream;
        video.srcObject = stream;
        return true;
      },
      play: () =>
        videoRef.current?.play().catch(() => undefined) ?? Promise.resolve(),
      unpublish(stream) {
        if (streamRef.current === stream) streamRef.current = null;
        if (videoRef.current?.srcObject === stream) {
          videoRef.current.srcObject = null;
        }
      },
    });

    if (result.status === "active") {
      setState("live");
      setMessage("Enquadre a folha inteira, com boa luz e sem cortar os códigos.");
      return;
    }
    if (result.status === "error") {
      stopStream();
      setState("fallback");
      setMessage(cameraMessage(result.error));
    }
  }, [invalidateCameraWork, requestStatus, stopStream]);

  const closeCamera = useCallback(() => {
    invalidateCameraWork();
    clearPreview();
    onClose();
  }, [clearPreview, invalidateCameraWork, onClose]);

  useEffect(() => {
    if (!isOpen) {
      invalidateCameraWork();
      return;
    }

    const startFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
      void startCamera();
    });

    return () => {
      window.cancelAnimationFrame(startFrame);
      invalidateCameraWork();
    };
  }, [invalidateCameraWork, isOpen, startCamera]);

  useEffect(() => {
    if (!isOpen) return;

    function pauseCamera() {
      invalidateCameraWork();
      if (!capturedFile) {
        setHasVideoDimensions(false);
        setState("paused");
        setMessage("A câmera foi pausada. Toque para abrir novamente.");
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "hidden") return;
      pauseCamera();
    }

    function handlePageHide() {
      pauseCamera();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeCamera();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [capturedFile, closeCamera, invalidateCameraWork, isOpen]);

  useLayoutEffect(() => {
    isOpenRef.current = isOpen;
    if (!isOpen) invalidateCameraWork();

    return () => {
      isOpenRef.current = false;
      invalidateCameraWork();
    };
  }, [invalidateCameraWork, isOpen]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      isOpenRef.current = false;
      invalidateCameraWork();
      previewStore.clear();
    };
  }, [invalidateCameraWork, previewStore]);

  if (!isOpen) return null;

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight || captureControllerRef.current) return;
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const track = streamRef.current?.getVideoTracks()[0];
    const ImageCaptureClass = (window as Window & { ImageCapture?: PhotoCaptureConstructor }).ImageCapture;
    let takePhoto: (() => Promise<Blob>) | undefined;
    try {
      if (track && track.readyState === "live" && typeof ImageCaptureClass === "function") {
        const capture = new ImageCaptureClass(track);
        if (typeof capture.takePhoto === "function") takePhoto = () => capture.takePhoto();
      }
    } catch { /* Unsupported track: use canvas. */ }
    const controller = new AbortController();
    captureControllerRef.current = controller;
    requestGenerationRef.current += 1;
    const captureGeneration = requestGenerationRef.current;
    setState("capturing");
    setMessage("Capturando foto...");
    try {
      const result = await captureAssistantCameraPhoto({
        takePhoto,
        signal: controller.signal,
        isCurrent: () => isAssistantCameraRequestCurrent(requestStatus(captureGeneration)),
        captureCanvas: () => {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext("2d");
          if (!context) return Promise.resolve(null);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
        },
      });
      completeAssistantCameraCapture({
        blob: result?.blob ?? null,
        isCurrent: () =>
          isAssistantCameraRequestCurrent(requestStatus(captureGeneration)),
        onMissing() {
          setState("fallback");
          setMessage("Não foi possível preparar esta foto. Tente novamente ou escolha uma imagem da galeria.");
        },
        onCaptured(capturedBlob) {
          clearPreview();
          const timestamp = Date.now();
          const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" }[capturedBlob.type] ?? "jpg";
          const file = new File([capturedBlob], `pedido-${timestamp}.${extension}`, {
            type: capturedBlob.type,
            lastModified: timestamp,
          });
          const url = URL.createObjectURL(file);
          previewStore.replace(url);
          setCapturedFile(file);
          setPreviewUrl(url);
          if (result) setCaptureMetadata({ source: result.source, videoWidth, videoHeight,
            width: result.dimensions.width, height: result.dimensions.height, bytes: file.size });
          setState("preview");
          setMessage("Confira a foto antes de usar.");
        },
      });
    } finally {
      if (captureControllerRef.current === controller) {
        captureControllerRef.current = null;
        stopStream();
      }
    }
  }

  function retakePhoto() {
    clearPreview();
    void startCamera();
  }

  function usePhoto() {
    if (!capturedFile) return;
    const file = capturedFile;
    invalidateCameraWork();
    clearPreview();
    onUsePhoto(file);
  }

  function useNativeCameraFallback() {
    invalidateCameraWork();
    clearPreview();
    onNativeCameraFallback();
  }

  function useGalleryFallback() {
    invalidateCameraWork();
    clearPreview();
    onGalleryFallback();
  }

  const isPreview = state === "preview" && previewUrl;
  const showFallback = state === "fallback" || state === "paused";

  return (
    <div
      className="fixed inset-0 z-50 flex min-h-[100dvh] items-stretch bg-brand-charcoal/95 p-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assistant-camera-title"
      data-capture-source={captureMetadata?.source}
      data-video-width={captureMetadata?.videoWidth}
      data-video-height={captureMetadata?.videoHeight}
      data-photo-width={captureMetadata?.width}
      data-photo-height={captureMetadata?.height}
      data-photo-bytes={captureMetadata?.bytes}
    >
      <section className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-white/15 bg-brand-charcoal text-white shadow-2xl sm:max-h-[min(48rem,calc(100dvh-2rem))] sm:max-w-2xl sm:flex-none">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div>
            <p className="text-[0.65rem] font-black tracking-[0.16em] text-brand-gold">ASSISTENTE NK</p>
            <h2 id="assistant-camera-title" className="mt-0.5 text-lg font-black">Fotografar Pedido</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeCamera}
            className="nk-focus inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/20 text-white transition hover:bg-white/10"
            aria-label="Fechar câmera"
          >
            <CloseIcon className="size-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-5">
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-black">
            {isPreview ? (
              // Local object URL: display original bytes, never request image optimization.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Prévia da foto capturada" className="max-h-full max-w-full object-contain" />
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={() => {
                    const video = videoRef.current;
                    setHasVideoDimensions(Boolean(video && video.videoWidth > 0 && video.videoHeight > 0));
                  }}
                  className={showFallback ? "hidden" : "h-full w-full object-contain"}
                />
                {!showFallback ? (
                  <div aria-hidden="true" className="pointer-events-none absolute inset-[8%] rounded-xl border border-brand-gold/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.12)]" />
                ) : null}
                {showFallback ? (
                  <div className="max-w-sm px-6 py-10 text-center">
                    <CameraIcon className="mx-auto size-10 text-brand-gold" />
                    <p className="mt-4 text-base font-black">Não foi possível acessar a câmera.</p>
                    <p className="mt-2 text-sm leading-6 text-white/75">{message}</p>
                  </div>
                ) : null}
                {state === "starting" ? (
                  <p role="status" className="absolute inset-x-4 bottom-4 rounded-xl bg-black/65 px-3 py-2 text-center text-sm font-semibold text-white">Abrindo câmera...</p>
                ) : null}
              </>
            )}
          </div>
          {!showFallback ? <p className="mt-3 text-center text-sm leading-5 text-white/75">{message}</p> : null}
        </div>

        <footer className="border-t border-white/10 px-3 py-3 sm:px-5">
          {isPreview ? (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={retakePhoto} className="nk-focus min-h-12 rounded-xl border border-white/25 px-4 text-sm font-black text-white transition hover:bg-white/10">
                Tirar novamente
              </button>
              <button type="button" onClick={usePhoto} className="nk-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-gold px-4 text-sm font-black text-brand-charcoal transition hover:bg-[#e8ad55]">
                <ImageIcon className="size-5" />
                Usar foto
              </button>
            </div>
          ) : showFallback ? (
            <div className="grid gap-2 sm:grid-cols-3">
              {state === "paused" ? (
                <button type="button" onClick={() => void startCamera()} className="nk-focus min-h-11 rounded-xl bg-brand-gold px-3 text-sm font-black text-brand-charcoal">
                  Abrir novamente
                </button>
              ) : null}
              <button type="button" onClick={useNativeCameraFallback} className="nk-focus min-h-11 rounded-xl border border-white/25 px-3 text-sm font-black text-white transition hover:bg-white/10">
                Abrir câmera do celular
              </button>
              <button type="button" onClick={useGalleryFallback} className="nk-focus min-h-11 rounded-xl border border-white/25 px-3 text-sm font-black text-white transition hover:bg-white/10">
                Escolher da galeria
              </button>
              <button type="button" onClick={closeCamera} className="nk-focus min-h-11 rounded-xl px-3 text-sm font-black text-white/75 transition hover:bg-white/10 hover:text-white">
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={state !== "live" || !hasVideoDimensions}
              onClick={() => void capturePhoto()}
              className="nk-focus mx-auto inline-flex min-h-12 w-full max-w-sm items-center justify-center gap-2 rounded-xl bg-brand-gold px-5 text-sm font-black text-brand-charcoal transition hover:bg-[#e8ad55] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CameraIcon className="size-5" />
              {state === "capturing" ? "Capturando..." : "Capturar foto"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
