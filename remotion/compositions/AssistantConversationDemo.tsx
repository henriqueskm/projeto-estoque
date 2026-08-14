import {AbsoluteFill, Sequence} from "remotion";
import {InventoryConversationScene} from "../scenes/InventoryConversationScene";
import {OutroScene} from "../scenes/OutroScene";
import {StatisticsConversationScene} from "../scenes/StatisticsConversationScene";

export const ASSISTANT_DEMO_WIDTH = 1920;
export const ASSISTANT_DEMO_HEIGHT = 1080;
export const ASSISTANT_DEMO_FPS = 30;
export const ASSISTANT_DEMO_DURATION = 600;

export function AssistantConversationDemo() {
  return (
    <AbsoluteFill style={{backgroundColor: "#171d21", fontFamily: "Arial, Helvetica, sans-serif"}}>
      <Sequence from={0} durationInFrames={300} premountFor={30}>
        <InventoryConversationScene />
      </Sequence>
      <Sequence from={270} durationInFrames={270} premountFor={30}>
        <StatisticsConversationScene />
      </Sequence>
      <Sequence from={510} durationInFrames={90} premountFor={24}>
        <OutroScene />
      </Sequence>
    </AbsoluteFill>
  );
}
