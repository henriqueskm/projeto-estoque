import { NextResponse } from "next/server";
import {
  assistantVoiceMaxFileBytes,
  assistantVoiceUploadFormat,
  validateAssistantVoiceAudio,
} from "@/lib/assistant-voice-contract";
import {
  AssistantVoiceProviderError,
  resolveAssistantVoiceModel,
  transcribeAssistantVoiceWithOpenAI,
} from "@/lib/ai/assistant-voice-transcription";
import { takeAssistantVoiceTranscriptionSlot } from "@/lib/assistant-voice-rate-limit";
import { createClient } from "@/lib/supabase/server";

const multipartOverheadAllowance = 64 * 1024;

class AssistantVoiceUploadSizeError extends Error {}

async function readVoiceMultipart(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing upload");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > assistantVoiceMaxFileBytes + multipartOverheadAllowance) {
        await reader.cancel();
        throw new AssistantVoiceUploadSizeError();
      }
      chunks.push(new Uint8Array(chunk.value));
    }
  } finally { reader.releaseLock(); }
  return new Response(new Blob(chunks), {
    headers: { "Content-Type": request.headers.get("content-type") ?? "" },
  }).formData();
}

function response(body: { transcript?: string; error?: string }, status: number, timing?: { auth: number; provider: number; total: number }) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...(timing ? { "Server-Timing": `auth;dur=${timing.auth.toFixed(1)}, provider;dur=${timing.provider.toFixed(1)}, total;dur=${timing.total.toFixed(1)}` } : {}),
    },
  });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;
  try {
    return new URL(origin).origin === origin && new URL(request.url).origin === origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  if (!isSameOrigin(request)) return response({ error: "Origem da solicitação não permitida." }, 403);

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data;")) {
    return response({ error: "Envie um áudio em formulário multipart." }, 415);
  }
  const rawContentLength = request.headers.get("content-length");
  if (rawContentLength !== null && !/^\d+$/.test(rawContentLength)) {
    return response({ error: "O tamanho da solicitação é inválido." }, 400);
  }
  const contentLength = rawContentLength === null ? null : Number(rawContentLength);
  if (contentLength !== null && contentLength > assistantVoiceMaxFileBytes + multipartOverheadAllowance) {
    return response({ error: "O áudio ficou muito longo. Grave uma mensagem menor." }, 413);
  }

  const authStartedAt = performance.now();
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) return response({ error: "Sua sessão expirou. Entre novamente." }, 401);
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (profileError) return response({ error: "Não foi possível validar seu acesso agora." }, 503);
  if (!profile) return response({ error: "Seu perfil não está ativo." }, 403);
  const serverAuthMs = performance.now() - authStartedAt;
  if (!takeAssistantVoiceTranscriptionSlot(userId)) {
    return response({ error: "Aguarde um momento antes de gravar novamente." }, 429);
  }

  let formData: FormData;
  try {
    formData = await readVoiceMultipart(request);
  } catch (error) {
    if (error instanceof AssistantVoiceUploadSizeError) return response({ error: "O áudio ficou muito longo. Grave uma mensagem menor." }, 413);
    return response({ error: "Não foi possível ler o áudio enviado." }, 400);
  }
  const entries = [...formData.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "audio" || !(entries[0]?.[1] instanceof File)) {
    return response({ error: "Envie exatamente uma gravação de áudio." }, 400);
  }
  const file = entries[0][1];
  const format = assistantVoiceUploadFormat(file.type);
  if (!format) {
    return response({ error: "A gravação de áudio é inválida." }, 415);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateAssistantVoiceAudio(file.type, bytes);
  if (!validation.ok) {
    return response({
      error: validation.reason === "duration" || validation.reason === "size"
        ? "O áudio ficou muito longo. Grave uma mensagem menor."
        : "A gravação de áudio é inválida.",
    }, validation.reason === "format" ? 415 : 413);
  }

  const providerStartedAt = performance.now();
  try {
    const transcript = await transcribeAssistantVoiceWithOpenAI({
      file: new File([bytes], `ditado-assistente.${format.extension}`, { type: format.mimeType }),
    });
    const providerMs = performance.now() - providerStartedAt;
    const totalMs = performance.now() - startedAt;
    console.info("assistant_voice_transcription", {
      outcome: "success",
      mimeType: format.mimeType,
      sizeBytes: file.size,
      serverAuthMs, providerMs, totalMs,
    });
    return response({ transcript }, 200, { auth: serverAuthMs, provider: providerMs, total: totalMs });
  } catch (error) {
    const providerError = error instanceof AssistantVoiceProviderError ? error : null;
    console.warn("assistant_voice_transcription", {
      outcome: "error",
      internalCode: providerError?.internalCode ?? "UNEXPECTED",
      providerStatus: providerError?.providerStatus ?? null,
      model: providerError?.model ?? resolveAssistantVoiceModel(),
      mimeType: format.mimeType,
      sizeBytes: file.size,
      serverAuthMs, providerMs: performance.now() - providerStartedAt,
      totalMs: performance.now() - startedAt,
    });
    return response({ error: "Não foi possível transcrever agora. Tente novamente em alguns instantes." },
      providerError?.internalCode === "CONFIGURATION" ? 503 : 502);
  }
}
