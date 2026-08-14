import {interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";
import {fadeWindow} from "../utils/animation";

const sceneDuration = 90;

export function OutroScene() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const progress = spring({frame, fps, config: {damping: 18, stiffness: 110}, durationInFrames: 34});

  return (
    <div style={{position: "absolute", inset: 0, display: "grid", placeItems: "center", overflow: "hidden", opacity: fadeWindow(frame, sceneDuration, 18, 12), background: "radial-gradient(circle at center, #263139 0%, #171d21 52%, #0d1114 100%)", color: "white"}}>
      <div style={{textAlign: "center", opacity: progress, transform: `translateY(${interpolate(progress, [0, 1], [32, 0])}px)`}}>
        <div style={{display: "inline-grid", width: 126, height: 126, placeItems: "center", border: "4px solid #d99a3d", borderRadius: "50%", color: "#d99a3d", fontSize: 48, fontWeight: 950, letterSpacing: -4}}>NK</div>
        <h2 style={{margin: "34px 0 12px", fontSize: 70, fontWeight: 950, letterSpacing: -2}}>Contexto. Dados oficiais. Controle.</h2>
        <p style={{margin: 0, color: "#d99a3d", fontSize: 28, fontWeight: 850, letterSpacing: 4}}>NK ESTOQUE</p>
      </div>
    </div>
  );
}
