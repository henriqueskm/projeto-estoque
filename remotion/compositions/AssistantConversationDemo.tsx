import {AbsoluteFill, Sequence} from "remotion";
import {InventoryConversationScene} from "../scenes/InventoryConversationScene";
import {OutroScene} from "../scenes/OutroScene";
import {StatisticsConversationScene} from "../scenes/StatisticsConversationScene";

export const ASSISTANT_DEMO_WIDTH = 1920;
export const ASSISTANT_DEMO_HEIGHT = 1080;
export const ASSISTANT_DEMO_FPS = 30;
export const ASSISTANT_DEMO_DURATION = 990;

export function AssistantConversationDemo() {
  return (
    <AbsoluteFill style={{backgroundColor: "#171d21", fontFamily: "Arial, Helvetica, sans-serif"}}>
      <Sequence from={0} durationInFrames={540} premountFor={30}>
        <InventoryConversationScene />
      </Sequence>
      <Sequence from={528} durationInFrames={384} premountFor={30}>
        <StatisticsConversationScene />
      </Sequence>
      <Sequence from={906} durationInFrames={84} premountFor={24}>
        <OutroScene />
      </Sequence>
    </AbsoluteFill>
  );
}
