export type AssistantVoicePermissionState =
  | "requesting_permission"
  | "recording"
  | "idle"
  | "preparing_audio"
  | "transcribing"
  | "error";

type TrackContainer = Pick<MediaStream, "getTracks">;

export function discardAssistantVoicePermissionResult(input: {
  stream: TrackContainer;
  isMounted: boolean;
  isCurrent: boolean;
  state: AssistantVoicePermissionState;
  isHidden: boolean;
}) {
  const shouldDiscard =
    !input.isMounted ||
    !input.isCurrent ||
    input.state !== "requesting_permission" ||
    input.isHidden;
  if (shouldDiscard) {
    input.stream.getTracks().forEach((track) => track.stop());
  }
  return shouldDiscard;
}
