import {interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {AssistantChrome, ChatMessage, demoColors} from "../components/AssistantChrome";
import {assistantDemoFixture} from "../data/assistant-demo-fixture";
import {entrance, fadeWindow} from "../utils/animation";

const sceneDuration = 300;

export function InventoryConversationScene() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const inventory = assistantDemoFixture.inventory;
  const scroll = interpolate(frame, [0, 250], [0, -310], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{position: "absolute", inset: 0, opacity: fadeWindow(frame, sceneDuration, 14, 24), background: "radial-gradient(circle at 25% 15%, #334047 0%, #171d21 55%, #0d1114 100%)"}}>
      <AssistantChrome>
        <div style={{position: "absolute", inset: 0, padding: "38px 54px 70px", transform: `translateY(${scroll}px)`}}>
          <ChatMessage side="user" style={entrance(frame, fps, 8)}>
            Quanto tem do {inventory.model}?
          </ChatMessage>
          <ChatMessage side="assistant" style={{marginTop: 24, ...entrance(frame, fps, 42)}}>
            <div>Você tem <strong>{inventory.totalQuantity} {inventory.model}</strong> no total.</div>
            <div style={{marginTop: 10, color: demoColors.muted, fontSize: 23}}>Se quiser, separo quantos estão com kit e quantos estão sem kit.</div>
          </ChatMessage>
          <ChatMessage side="user" style={{marginTop: 24, ...entrance(frame, fps, 88)}}>
            Quantos com kit?
          </ChatMessage>
          <ChatMessage side="assistant" style={{marginTop: 24, ...entrance(frame, fps, 124)}}>
            <div>Você tem <strong>{inventory.mountedQuantity} {inventory.model}</strong> montados com kit.</div>
            <div style={{marginTop: 10, color: demoColors.muted, fontSize: 23}}>Posso mostrar em quais configurações eles estão.</div>
          </ChatMessage>
          <ChatMessage side="user" style={{marginTop: 24, ...entrance(frame, fps, 168)}}>Sim</ChatMessage>
          <ChatMessage side="assistant" style={{marginTop: 24, ...entrance(frame, fps, 198)}}>
            <div>Esses <strong>{inventory.mountedQuantity} {inventory.model}</strong> montados com kit estão distribuídos nestas configurações:</div>
            <div style={{marginTop: 20, overflow: "hidden", border: `1px solid ${demoColors.border}`, borderRadius: 20, background: "#faf9f6"}}>
              <div style={{padding: "15px 20px", color: "#9a6a28", fontSize: 15, fontWeight: 950, letterSpacing: 2.2}}>CONFIGURAÇÕES COM KIT</div>
              <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: 22, padding: "18px 20px", borderTop: `1px solid ${demoColors.border}`}}>
                <div>
                  <div style={{fontSize: 20, fontWeight: 900}}>Cód. {inventory.officialConfigurationCodes.join(" · ")}</div>
                  <div style={{marginTop: 6, color: demoColors.muted, fontSize: 17}}>Configurações oficiais do modelo {inventory.model}</div>
                </div>
                <div style={{minWidth: 82, textAlign: "center"}}>
                  <div style={{fontSize: 31, fontWeight: 950}}>{inventory.mountedQuantity}</div>
                  <div style={{color: demoColors.muted, fontSize: 13, fontWeight: 850}}>MONTADOS</div>
                </div>
              </div>
            </div>
          </ChatMessage>
        </div>
      </AssistantChrome>
    </div>
  );
}
