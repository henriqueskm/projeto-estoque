import {Composition} from "remotion";
import {AssistantConversationDemo} from "./compositions/AssistantConversationDemo";

export function RemotionRoot() {
  return (
    <Composition
      id="AssistantConversationDemo"
      component={AssistantConversationDemo}
      durationInFrames={600}
      fps={30}
      width={1920}
      height={1080}
    />
  );
}
