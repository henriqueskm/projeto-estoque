import {
  assistantVoiceBitsPerSample,
  assistantVoiceChannels,
  assistantVoiceMaxDurationSeconds,
  assistantVoiceMaxFileBytes,
  assistantVoiceMimeType,
  assistantVoiceSampleRate,
} from "@/lib/assistant-voice-contract";

export class AssistantVoicePreparationError extends Error {}

type AudioContextConstructor = new () => AudioContext;

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function preferredAssistantVoiceRecorderMimeType(
  isTypeSupported: (mimeType: string) => boolean,
) {
  return [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ].find((mimeType) => isTypeSupported(mimeType)) ?? null;
}

export function resampleAssistantVoiceToMono(
  audioBuffer: AudioBuffer,
  targetSampleRate = assistantVoiceSampleRate,
) {
  const frameCount = Math.max(
    1,
    Math.round(audioBuffer.duration * targetSampleRate),
  );
  const output = new Float32Array(frameCount);
  const sourceChannels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, index) => audioBuffer.getChannelData(index),
  );

  for (let frame = 0; frame < frameCount; frame += 1) {
    const sourcePosition = (frame * audioBuffer.sampleRate) / targetSampleRate;
    const lowerIndex = Math.min(
      sourceChannels[0].length - 1,
      Math.floor(sourcePosition),
    );
    const upperIndex = Math.min(
      sourceChannels[0].length - 1,
      lowerIndex + 1,
    );
    const interpolation = sourcePosition - lowerIndex;
    let sample = 0;
    for (const channel of sourceChannels) {
      sample +=
        channel[lowerIndex] * (1 - interpolation) +
        channel[upperIndex] * interpolation;
    }
    output[frame] = sample / sourceChannels.length;
  }

  return output;
}

export function encodeAssistantVoiceWav(samples: Float32Array) {
  const bytesPerSample = assistantVoiceBitsPerSample / 8;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, assistantVoiceChannels, true);
  view.setUint32(24, assistantVoiceSampleRate, true);
  view.setUint32(28, assistantVoiceSampleRate * bytesPerSample, true);
  view.setUint16(32, assistantVoiceChannels * bytesPerSample, true);
  view.setUint16(34, assistantVoiceBitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * bytesPerSample, Math.round(clamped * 32_767), true);
  }

  return new Uint8Array(buffer);
}

function browserAudioContext() {
  const browserWindow = window as Window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return window.AudioContext ?? browserWindow.webkitAudioContext ?? null;
}

export async function prepareAssistantVoiceAudio(blob: Blob): Promise<File> {
  if (!blob.size) {
    throw new AssistantVoicePreparationError("Não consegui identificar uma fala nesse áudio.");
  }

  const AudioContextClass = browserAudioContext();
  if (!AudioContextClass) {
    throw new AssistantVoicePreparationError("Este navegador não permite preparar a gravação de áudio.");
  }

  const context = new AudioContextClass();
  try {
    const encodedAudio = await blob.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(encodedAudio.slice(0));
    if (
      !Number.isFinite(audioBuffer.duration) ||
      audioBuffer.duration <= 0 ||
      audioBuffer.duration > assistantVoiceMaxDurationSeconds
    ) {
      throw new AssistantVoicePreparationError("O áudio ficou muito longo. Grave uma mensagem menor.");
    }

    const wav = encodeAssistantVoiceWav(resampleAssistantVoiceToMono(audioBuffer));
    if (wav.byteLength > assistantVoiceMaxFileBytes) {
      throw new AssistantVoicePreparationError("O áudio ficou muito longo. Grave uma mensagem menor.");
    }

    return new File([wav], "ditado-assistente.wav", {
      type: assistantVoiceMimeType,
      lastModified: Date.now(),
    });
  } catch (error) {
    if (error instanceof AssistantVoicePreparationError) throw error;
    throw new AssistantVoicePreparationError("Não foi possível preparar esta gravação. Tente novamente.");
  } finally {
    await context.close().catch(() => undefined);
  }
}
