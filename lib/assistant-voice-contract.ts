export const assistantVoiceMimeType = "audio/wav";
export const assistantVoiceSampleRate = 16_000;
export const assistantVoiceChannels = 1;
export const assistantVoiceBitsPerSample = 16;
export const assistantVoiceMaxDurationSeconds = 60;
export const assistantVoiceMaxFileBytes = 2_100_000;
export const assistantVoiceMaxTranscriptLength = 1_000;
export const assistantVoiceClientTimeoutMs = 30_000;

export function assistantVoiceUploadFormat(value: string) {
  const mime = value.toLowerCase().replace(/\s|"/g, "");
  if (mime === "audio/webm" || mime === "audio/webm;codecs=opus") return { mimeType: "audio/webm", extension: "webm" } as const;
  if (mime === "audio/ogg" || mime === "audio/ogg;codecs=opus") return { mimeType: "audio/ogg", extension: "ogg" } as const;
  if (mime === "audio/mp4" || mime === "audio/mp4;codecs=mp4a.40.2") return { mimeType: "audio/mp4", extension: "mp4" } as const;
  if (mime === "audio/wav" || mime === "audio/x-wav") return { mimeType: "audio/wav", extension: "wav" } as const;
  return null;
}

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
  requireCanonical = true,
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
    ![1, 2].includes(format.channels) ||
    format.sampleRate < 8_000 || format.sampleRate > 96_000 ||
    ![8, 16, 24, 32].includes(format.bitsPerSample) ||
    format.blockAlign !== format.channels * format.bitsPerSample / 8 ||
    format.byteRate !== format.sampleRate * format.blockAlign ||
    (requireCanonical && (format.channels !== assistantVoiceChannels ||
      format.sampleRate !== assistantVoiceSampleRate || format.bitsPerSample !== assistantVoiceBitsPerSample)) ||
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

export function validateAssistantVoiceAudio(mime: string, bytes: Uint8Array) {
  const format = assistantVoiceUploadFormat(mime);
  if (!format) return { ok: false as const, reason: "format" as const };
  if (!bytes.length || bytes.length > assistantVoiceMaxFileBytes) return { ok: false as const, reason: "size" as const };
  if (format.extension === "wav") {
    const info = readAssistantVoiceWavInfo(bytes, false);
    if (!info || !info.dataBytes) return { ok: false as const, reason: "format" as const };
    if (info.durationSeconds > assistantVoiceMaxDurationSeconds) return { ok: false as const, reason: "duration" as const };
  } else {
    const valid = format.extension === "webm"
      ? bytes.length >= 16 && [0x1a, 0x45, 0xdf, 0xa3].every((byte, index) => bytes[index] === byte)
        && new TextDecoder().decode(bytes.slice(0, 1024)).includes("webm")
      : format.extension === "ogg"
        ? bytes.length >= 32 && readsAscii(bytes, 0, "OggS")
          && new TextDecoder().decode(bytes.slice(0, 1024)).includes("OpusHead")
        : bytes.length >= 16 && readsAscii(bytes, 4, "ftyp")
          && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) >= 16;
    if (!valid) return { ok: false as const, reason: "format" as const };
  }
  return { ok: true as const, format };
}
