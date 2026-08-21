"use client";

import {Player} from "@remotion/player";
import {
  ASSISTANT_DEMO_DURATION,
  ASSISTANT_DEMO_FPS,
  ASSISTANT_DEMO_HEIGHT,
  ASSISTANT_DEMO_WIDTH,
  AssistantConversationDemo,
} from "@/remotion/compositions/AssistantConversationDemo";

export default function AssistantDemoRuntime() {
  return (
    <div className="assistant-demo-player-shell" data-remotion-assistant-demo>
      <Player
        component={AssistantConversationDemo}
        durationInFrames={ASSISTANT_DEMO_DURATION}
        compositionWidth={ASSISTANT_DEMO_WIDTH}
        compositionHeight={ASSISTANT_DEMO_HEIGHT}
        fps={ASSISTANT_DEMO_FPS}
        autoPlay
        loop={false}
        controls
        acknowledgeRemotionLicense
        style={{width: "100%", aspectRatio: "16 / 9"}}
      />
      <p>Demo visual com dados estáticos aprovados. Nenhuma operação é executada.</p>
    </div>
  );
}
