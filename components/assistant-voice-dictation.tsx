"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicrophoneIcon } from "@/components/icons";
import {
  AssistantVoicePreparationError,
  preferredAssistantVoiceRecorderMimeType,
  prepareAssistantVoiceAudio,
} from "@/lib/assistant-voice-audio";
import { assistantVoiceMaxDurationSeconds } from "@/lib/assistant-voice-contract";

type AssistantVoiceDictationState =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "preparing_audio"
  | "transcribing"
  | "error";

type AssistantVoiceDictationProps = {
  disabled: boolean;
  cameraOpen: boolean;
  onBusyChange: (isBusy: boolean) => void;
  onRequestStart: () => void;
  onTranscript: (transcript: string) => boolean;
};

function voiceMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Permita o acesso ao microfone para usar o ditado.";
    }
    if (error.name === "NotFoundError") {
      return "Não encontramos um microfone disponível neste dispositivo.";
    }
  }
  return "Não foi possível iniciar a gravação. Tente novamente.";
}

function elapsedLabel(seconds: number) {
  return `00:${String(Math.min(seconds, assistantVoiceMaxDurationSeconds)).padStart(2, "0")}`;
}

export function AssistantVoiceDictation({
  disabled,
  cameraOpen,
  onBusyChange,
  onRequestStart,
  onTranscript,
}: AssistantVoiceDictationProps) {
  const [state, setState] = useState<AssistantVoiceDictationState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopModeRef = useRef<"cancel" | "transcribe">("cancel");
  const stateRef = useRef<AssistantVoiceDictationState>("idle");
  const startedAtRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const limitTimerRef = useRef<number | null>(null);
  const processingIdRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const transition = useCallback((nextState: AssistantVoiceDictationState) => {
    stateRef.current = nextState;
    if (mountedRef.current) setState(nextState);
  }, []);

  const clearTimers = useCallback(() => {
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    if (limitTimerRef.current !== null) {
      window.clearTimeout(limitTimerRef.current);
      limitTimerRef.current = null;
    }
    startedAtRef.current = null;
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const clearPendingWork = useCallback(() => {
    processingIdRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    chunksRef.current = [];
    clearTimers();
  }, [clearTimers]);

  const showError = useCallback((nextMessage: string) => {
    clearPendingWork();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    stopTracks();
    setMessage(nextMessage);
    transition("error");
  }, [clearPendingWork, stopTracks, transition]);

  const finishTranscription = useCallback(async (blob: Blob, processingId: number) => {
    transition("preparing_audio");
    setMessage("Preparando áudio...");
    try {
      const audio = await prepareAssistantVoiceAudio(blob);
      if (processingId !== processingIdRef.current) return;
      transition("transcribing");
      setMessage("Transcrevendo...");
      const abortController = new AbortController();
      requestAbortRef.current = abortController;
      const requestTimeout = window.setTimeout(
        () => abortController.abort(),
        55_000,
      );
      const formData = new FormData();
      formData.append("audio", audio);
      let response: Response;
      try {
        response = await fetch("/api/assistant/transcribe", {
          method: "POST",
          body: formData,
          signal: abortController.signal,
        });
      } finally {
        window.clearTimeout(requestTimeout);
        if (requestAbortRef.current === abortController) {
          requestAbortRef.current = null;
        }
      }
      if (processingId !== processingIdRef.current) return;
      const body: unknown = await response.json().catch(() => null);
      const transcript = body && typeof body === "object" && !Array.isArray(body)
        ? (body as { transcript?: unknown }).transcript
        : null;
      if (!response.ok || typeof transcript !== "string" || !transcript.trim()) {
        const safeError = body && typeof body === "object" && !Array.isArray(body)
          ? (body as { error?: unknown }).error
          : null;
        throw new Error(
          typeof safeError === "string" && safeError.trim()
            ? safeError
            : "Não foi possível transcrever agora. Tente novamente.",
        );
      }
      if (!onTranscript(transcript)) {
        throw new Error("A transcrição ficou muito longa para o campo de mensagem.");
      }
      chunksRef.current = [];
      setMessage(null);
      transition("idle");
    } catch (error) {
      if (processingId !== processingIdRef.current) return;
      const safeMessage = error instanceof AssistantVoicePreparationError
        ? error.message
        : error instanceof Error && error.name === "AbortError"
          ? "Não foi possível transcrever agora. Tente novamente."
          : error instanceof Error && error.message
            ? error.message
            : "Não foi possível transcrever agora. Tente novamente.";
      showError(safeMessage);
    }
  }, [onTranscript, showError, transition]);

  const stopRecording = useCallback((shouldTranscribe: boolean) => {
    if (stateRef.current !== "recording") return;
    clearTimers();
    stopModeRef.current = shouldTranscribe ? "transcribe" : "cancel";
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      recorderRef.current = null;
      stopTracks();
      chunksRef.current = [];
      transition("idle");
      return;
    }
    if (shouldTranscribe) {
      transition("preparing_audio");
      setMessage("Preparando áudio...");
    } else {
      stopTracks();
      transition("idle");
      setMessage(null);
    }
    recorder.stop();
  }, [clearTimers, stopTracks, transition]);

  const cancelPendingPreparation = useCallback(() => {
    clearPendingWork();
    stopTracks();
    setMessage(null);
    transition("idle");
  }, [clearPendingWork, stopTracks, transition]);

  const startRecording = useCallback(async () => {
    const currentState = stateRef.current;
    if (disabled || cameraOpen || (currentState !== "idle" && currentState !== "error")) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      showError("Este navegador não permite gravação de áudio.");
      return;
    }

    onRequestStart();
    onBusyChange(true);
    setMessage(null);
    setElapsedSeconds(0);
    transition("requesting_permission");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const stillRequestingPermission = () => stateRef.current === "requesting_permission";
      if (!mountedRef.current || !stillRequestingPermission()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      chunksRef.current = [];
      stopModeRef.current = "cancel";
      const mimeType = typeof MediaRecorder.isTypeSupported === "function"
        ? preferredAssistantVoiceRecorderMimeType(
          MediaRecorder.isTypeSupported.bind(MediaRecorder),
        )
        : null;
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        if (recorderRef.current === recorder) {
          showError("Não foi possível concluir a gravação. Tente novamente.");
        }
      };
      recorder.onstop = () => {
        if (recorderRef.current !== recorder) return;
        recorderRef.current = null;
        stopTracks();
        const shouldTranscribe = stopModeRef.current === "transcribe";
        const chunks = chunksRef.current;
        chunksRef.current = [];
        if (!shouldTranscribe) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) {
          showError("Não consegui identificar uma fala nesse áudio.");
          return;
        }
        const processingId = processingIdRef.current + 1;
        processingIdRef.current = processingId;
        void finishTranscription(blob, processingId);
      };
      stream.addEventListener("inactive", () => {
        if (stateRef.current === "recording" && recorderRef.current === recorder) {
          showError("A gravação foi interrompida. Tente novamente.");
        }
      });
      recorder.start(250);
      startedAtRef.current = Date.now();
      elapsedTimerRef.current = window.setInterval(() => {
        if (!startedAtRef.current) return;
        setElapsedSeconds(
          Math.min(
            assistantVoiceMaxDurationSeconds,
            Math.floor((Date.now() - startedAtRef.current) / 1_000),
          ),
        );
      }, 250);
      limitTimerRef.current = window.setTimeout(() => {
        stopRecording(true);
      }, assistantVoiceMaxDurationSeconds * 1_000);
      transition("recording");
    } catch (error) {
      stopTracks();
      showError(voiceMessage(error));
    }
  }, [cameraOpen, disabled, finishTranscription, onRequestStart, showError, stopRecording, stopTracks, transition]);

  useEffect(() => {
    const isBusy = state !== "idle" && state !== "error";
    onBusyChange(isBusy);
  }, [onBusyChange, state]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== "hidden" || stateRef.current !== "recording") return;
      stopModeRef.current = "cancel";
      clearTimers();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      stopTracks();
      chunksRef.current = [];
      setMessage("A gravação foi cancelada ao deixar o app em segundo plano.");
      transition("error");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [clearTimers, stopTracks, transition]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      clearPendingWork();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      stopTracks();
      onBusyChange(false);
    };
  }, [clearPendingWork, onBusyChange, stopTracks]);

  const isRecording = state === "recording";
  const canStart = !disabled && !cameraOpen && (state === "idle" || state === "error");

  return (
    <>
      <button
        type="button"
        disabled={!canStart}
        onClick={() => void startRecording()}
        aria-label="Gravar mensagem por voz"
        className="nk-focus inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-app-background text-text-primary transition hover:bg-brand-gold-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        <MicrophoneIcon className="size-5" />
      </button>

      {state === "requesting_permission" || isRecording || state === "preparing_audio" || state === "transcribing" ? (
        <div role="status" aria-live="polite" className="basis-full rounded-xl bg-app-background px-3 py-2 text-xs font-semibold text-text-muted">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {isRecording
                ? `🎙 Gravando ${elapsedLabel(elapsedSeconds)}`
                : state === "requesting_permission"
                  ? "Solicitando acesso ao microfone..."
                  : message ?? "Preparando áudio..."}
            </span>
            {isRecording || state === "preparing_audio" ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={isRecording ? () => stopRecording(false) : cancelPendingPreparation}
                  className="nk-focus min-h-9 rounded-lg px-2.5 text-xs font-black text-text-primary transition hover:bg-surface"
                  aria-label="Cancelar gravação"
                >
                  Cancelar
                </button>
                {isRecording ? (
                  <button
                    type="button"
                    onClick={() => stopRecording(true)}
                    className="nk-focus min-h-9 rounded-lg bg-brand-charcoal px-3 text-xs font-black text-white transition hover:bg-black"
                    aria-label="Parar gravação"
                  >
                    Parar
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {state === "error" && message ? (
        <p role="status" aria-live="polite" className="basis-full px-1 text-xs leading-5 font-semibold text-red-800">
          {message}
        </p>
      ) : null}
    </>
  );
}
