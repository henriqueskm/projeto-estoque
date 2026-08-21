"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraIcon, CloseIcon, ImageIcon } from "@/components/icons";

type CameraState = "starting" | "live" | "preview" | "paused" | "fallback";

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
  const previewUrlRef = useRef<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<CameraState>("starting");
  const [message, setMessage] = useState("Abrindo câmera...");
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hasVideoDimensions, setHasVideoDimensions] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const clearPreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setCapturedFile(null);
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("fallback");
      setMessage("A câmera integrada não está disponível neste navegador.");
      return;
    }

    stopStream();
    setHasVideoDimensions(false);
    setState("starting");
    setMessage("Abrindo câmera...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
        },
        audio: false,
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setState("live");
      setMessage("Enquadre a folha inteira, com boa luz e sem cortar os códigos.");
    } catch (error) {
      stopStream();
      setState("fallback");
      setMessage(cameraMessage(error));
    }
  }, [stopStream]);

  const closeCamera = useCallback(() => {
    stopStream();
    clearPreview();
    onClose();
  }, [clearPreview, onClose, stopStream]);

  useEffect(() => {
    if (!isOpen) return;

    let disposed = false;
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    void startCamera().then(() => {
      if (disposed) stopStream();
    });

    return () => {
      disposed = true;
      stopStream();
    };
  }, [isOpen, startCamera, stopStream]);

  useEffect(() => {
    if (!isOpen) return;

    function handleVisibilityChange() {
      if (document.visibilityState !== "hidden") return;
      stopStream();
      if (!capturedFile) {
        setHasVideoDimensions(false);
        setState("paused");
        setMessage("A câmera foi pausada. Toque para abrir novamente.");
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeCamera();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [capturedFile, closeCamera, isOpen, stopStream]);

  useEffect(() => {
    return () => {
      stopStream();
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, [stopStream]);

  if (!isOpen) return null;

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setState("fallback");
      setMessage("Não foi possível preparar esta foto. Tente novamente ou escolha uma imagem da galeria.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setState("fallback");
        setMessage("Não foi possível preparar esta foto. Tente novamente ou escolha uma imagem da galeria.");
        return;
      }

      clearPreview();
      const timestamp = Date.now();
      const file = new File([blob], `pedido-${timestamp}.jpg`, {
        type: "image/jpeg",
        lastModified: timestamp,
      });
      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setCapturedFile(file);
      setPreviewUrl(url);
      video.pause();
      setState("preview");
      setMessage("Confira a foto antes de usar.");
    }, "image/jpeg", 0.92);
  }

  function retakePhoto() {
    clearPreview();
    const video = videoRef.current;
    if (streamRef.current && video) {
      video.srcObject = streamRef.current;
      void video.play().catch(() => undefined);
      setState("live");
      setMessage("Enquadre a folha inteira, com boa luz e sem cortar os códigos.");
      return;
    }
    void startCamera();
  }

  function usePhoto() {
    if (!capturedFile) return;
    const file = capturedFile;
    stopStream();
    clearPreview();
    onUsePhoto(file);
  }

  function useNativeCameraFallback() {
    stopStream();
    clearPreview();
    onNativeCameraFallback();
  }

  function useGalleryFallback() {
    stopStream();
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
              onClick={capturePhoto}
              className="nk-focus mx-auto inline-flex min-h-12 w-full max-w-sm items-center justify-center gap-2 rounded-xl bg-brand-gold px-5 text-sm font-black text-brand-charcoal transition hover:bg-[#e8ad55] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CameraIcon className="size-5" />
              Capturar foto
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
