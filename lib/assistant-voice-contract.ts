export const assistantVoiceMimeType = "audio/wav";
export const assistantVoiceSampleRate = 16_000;
export const assistantVoiceChannels = 1;
export const assistantVoiceBitsPerSample = 16;
export const assistantVoiceMaxDurationSeconds = 60;
export const assistantVoiceMaxFileBytes = 2_100_000;
export const assistantVoiceMaxTranscriptLength = 1_000;

export type AssistantVoiceWavInfo = {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: number;
  durationSeconds: number;
};

function readsAscii(bytes: Uint8Array, offset: number, expected: string) {
  if (offset + expected.length > bytes.length) return false;
  return expected.split("").every((character, index) =>
    bytes[offset + index] === character.charCodeAt(0),
  );
}

export function readAssistantVoiceWavInfo(
  bytes: Uint8Array,
): AssistantVoiceWavInfo | null {
  if (
    bytes.length < 44 ||
    !readsAscii(bytes, 0, "RIFF") ||
    !readsAscii(bytes, 8, "WAVE")
  ) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let format: {
    audioFormat: number;
    channels: number;
    sampleRate: number;
    byteRate: number;
    blockAlign: number;
    bitsPerSample: number;
  } | null = null;
  let dataBytes: number | null = null;

  while (offset + 8 <= bytes.length) {
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;
    const chunkDataEnd = chunkDataStart + chunkSize;
    if (chunkDataEnd > bytes.length) return null;

    if (readsAscii(bytes, offset, "fmt ")) {
      if (chunkSize < 16) return null;
      format = {
        audioFormat: view.getUint16(chunkDataStart, true),
        channels: view.getUint16(chunkDataStart + 2, true),
        sampleRate: view.getUint32(chunkDataStart + 4, true),
        byteRate: view.getUint32(chunkDataStart + 8, true),
        blockAlign: view.getUint16(chunkDataStart + 12, true),
        bitsPerSample: view.getUint16(chunkDataStart + 14, true),
      };
    } else if (readsAscii(bytes, offset, "data")) {
      dataBytes = chunkSize;
      break;
    }

    offset = chunkDataEnd + (chunkSize % 2);
  }

  if (!format || dataBytes === null) return null;
  if (
    format.audioFormat !== 1 ||
    format.channels !== assistantVoiceChannels ||
    format.sampleRate !== assistantVoiceSampleRate ||
    format.bitsPerSample !== assistantVoiceBitsPerSample ||
    format.blockAlign !== 2 ||
    format.byteRate !== assistantVoiceSampleRate * 2 ||
    dataBytes % format.blockAlign !== 0
  ) {
    return null;
  }

  return {
    channels: format.channels,
    sampleRate: format.sampleRate,
    bitsPerSample: format.bitsPerSample,
    dataBytes,
    durationSeconds: dataBytes / format.byteRate,
  };
}

export function validateAssistantVoiceWav(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > assistantVoiceMaxFileBytes) {
    return { ok: false as const, reason: "size" as const };
  }

  const info = readAssistantVoiceWavInfo(bytes);
  if (!info) return { ok: false as const, reason: "format" as const };
  if (info.durationSeconds > assistantVoiceMaxDurationSeconds) {
    return { ok: false as const, reason: "duration" as const };
  }

  return { ok: true as const, info };
}

export function appendAssistantVoiceTranscript(draft: string, transcript: string) {
  const currentDraft = draft.trimEnd();
  const normalizedTranscript = transcript.trim();
  if (!currentDraft) return normalizedTranscript;
  if (!normalizedTranscript) return currentDraft;
  return `${currentDraft} ${normalizedTranscript}`;
}
