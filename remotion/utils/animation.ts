import {interpolate, spring} from "remotion";

export function fadeWindow(
  frame: number,
  durationInFrames: number,
  fadeInFrames = 18,
  fadeOutFrames = 18,
) {
  return interpolate(
    frame,
    [0, fadeInFrames, durationInFrames - fadeOutFrames, durationInFrames],
    [0, 1, 1, 0],
    {extrapolateLeft: "clamp", extrapolateRight: "clamp"},
  );
}

export function entrance(
  frame: number,
  fps: number,
  startFrame: number,
  distance = 28,
) {
  const progress = spring({
    frame: frame - startFrame,
    fps,
    config: {damping: 20, mass: 0.8, stiffness: 140},
    durationInFrames: 14,
  });

  return {
    opacity: interpolate(progress, [0, 1], [0, 1]),
    translate: `0 ${interpolate(progress, [0, 1], [distance, 0])}px`,
  };
}
