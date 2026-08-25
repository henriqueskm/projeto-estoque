import { NextResponse } from "next/server";
import {
  assistantVoiceMaxFileBytes,
  assistantVoiceMimeType,
  validateAssistantVoiceWav,
} from "@/lib/assistant-voice-contract";
import {
  AssistantVoiceProviderError,
  resolveAssistantVoiceModel,
  transcribeAssistantVoiceWithGemini,
} from "@/lib/ai/assistant-voice-transcription";
import { takeAssistantVoiceTranscriptionSlot } from "@/lib/assistant-voice-rate-limit";
import { createClient } from "@/lib/supabase/server";

const multipartOverheadAllowance = 64 * 1024;

function response(body: { transcript?: string; error?: string }, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
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
  const startedAt = Date.now();
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
  if (!takeAssistantVoiceTranscriptionSlot(userId)) {
    return response({ error: "Aguarde um momento antes de gravar novamente." }, 429);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return response({ error: "Não foi possível ler o áudio enviado." }, 400);
  }
  const entries = [...formData.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "audio" || !(entries[0]?.[1] instanceof File)) {
    return response({ error: "Envie exatamente uma gravação de áudio." }, 400);
  }
  const file = entries[0][1];
  if (file.type.toLowerCase() !== assistantVoiceMimeType) {
    return response({ error: "A gravação de áudio é inválida." }, 415);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateAssistantVoiceWav(bytes);
  if (!validation.ok) {
    return response({
      error: validation.reason === "duration" || validation.reason === "size"
        ? "O áudio ficou muito longo. Grave uma mensagem menor."
        : "A gravação de áudio é inválida.",
    }, validation.reason === "format" ? 415 : 413);
  }

  try {
    const transcript = await transcribeAssistantVoiceWithGemini({ bytes });
    console.info("assistant_voice_transcription", {
      outcome: "success",
      mimeType: assistantVoiceMimeType,
      sizeBytes: file.size,
      durationMs: Date.now() - startedAt,
    });
    return response({ transcript }, 200);
  } catch (error) {
    const providerError = error instanceof AssistantVoiceProviderError ? error : null;
    console.warn("assistant_voice_transcription", {
      outcome: "error",
      internalCode: providerError?.internalCode ?? "UNEXPECTED",
      providerStatus: providerError?.providerStatus ?? null,
      model: providerError?.model ?? resolveAssistantVoiceModel(),
      mimeType: assistantVoiceMimeType,
      sizeBytes: file.size,
      durationMs: Date.now() - startedAt,
    });
    return response({ error: "Não foi possível transcrever agora. Tente novamente." }, 502);
  }
}
