type TrackContainer = Pick<MediaStream, "getTracks">;

export type AssistantCameraRequestStatus = {
  isMounted: boolean;
  isOpen: boolean;
  isCurrent: boolean;
  isHidden: boolean;
};

export function isAssistantCameraRequestCurrent(
  status: AssistantCameraRequestStatus,
) {
  return (
    status.isMounted &&
    status.isOpen &&
    status.isCurrent &&
    !status.isHidden
  );
}

export function discardAssistantCameraStream(
  stream: TrackContainer,
  status: AssistantCameraRequestStatus,
) {
  const shouldDiscard = !isAssistantCameraRequestCurrent(status);
  if (shouldDiscard) {
    stream.getTracks().forEach((track) => track.stop());
  }
  return shouldDiscard;
}

export type AssistantCameraRequestResult =
  | { status: "active" }
  | { status: "stale" }
  | { status: "unavailable" }
  | { status: "error"; error: unknown };

export async function runAssistantCameraRequest(input: {
  acquire: () => Promise<MediaStream>;
  isCurrent: () => boolean;
  publish: (stream: MediaStream) => boolean;
  play: (stream: MediaStream) => Promise<unknown>;
  unpublish: (stream: MediaStream) => void;
}): Promise<AssistantCameraRequestResult> {
  let stream: MediaStream | null = null;

  try {
    stream = await input.acquire();
    if (!input.isCurrent()) {
      stream.getTracks().forEach((track) => track.stop());
      return { status: "stale" };
    }
    if (!input.publish(stream)) {
      stream.getTracks().forEach((track) => track.stop());
      return { status: "unavailable" };
    }

    await input.play(stream);
    if (!input.isCurrent()) {
      stream.getTracks().forEach((track) => track.stop());
      input.unpublish(stream);
      return { status: "stale" };
    }

    return { status: "active" };
  } catch (error) {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      input.unpublish(stream);
    }
    return input.isCurrent()
      ? { status: "error", error }
      : { status: "stale" };
  }
}

export function createAssistantCameraPreviewStore(
  revokeObjectUrl: (url: string) => void,
) {
  let currentUrl: string | null = null;

  return {
    get currentUrl() {
      return currentUrl;
    },
    replace(nextUrl: string) {
      if (currentUrl) revokeObjectUrl(currentUrl);
      currentUrl = nextUrl;
    },
    clear() {
      if (currentUrl) revokeObjectUrl(currentUrl);
      currentUrl = null;
    },
  };
}

export function completeAssistantCameraCapture(input: {
  blob: Blob | null;
  isCurrent: () => boolean;
  onMissing: () => void;
  onCaptured: (blob: Blob) => void;
}) {
  if (!input.isCurrent()) return "stale" as const;
  if (!input.blob) {
    input.onMissing();
    return "missing" as const;
  }
  input.onCaptured(input.blob);
  return "captured" as const;
}
