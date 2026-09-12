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
