import {interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {AssistantChrome, ChatMessage, demoColors} from "../components/AssistantChrome";
import {assistantDemoFixture} from "../data/assistant-demo-fixture";
import {entrance, fadeWindow} from "../utils/animation";

const sceneDuration = 540;

export function InventoryConversationScene() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const inventory = assistantDemoFixture.inventory;
  const mountedConfigurationBreakdown = inventory.mountedConfigurationBreakdown;
  const hasCompleteMountedBreakdown = mountedConfigurationBreakdown.kind === "complete";
  const scroll = interpolate(frame, [0, 362, 382, 516], [0, 0, -340, -340], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{position: "absolute", inset: 0, opacity: fadeWindow(frame, sceneDuration, 14, 24), background: "radial-gradient(circle at 25% 15%, #334047 0%, #171d21 55%, #0d1114 100%)"}}>
      <AssistantChrome>
        <div style={{position: "absolute", inset: 0, padding: "38px 54px 70px", translate: `0 ${scroll}px`}}>
          <ChatMessage side="user" style={entrance(frame, fps, 30, 16)}>
            Quanto tem do {inventory.model}?
          </ChatMessage>
          <ChatMessage side="assistant" style={{marginTop: 24, ...entrance(frame, fps, 82, 16)}}>
            <div>Você tem <strong>{inventory.totalQuantity} {inventory.model}</strong> no total.</div>
            <div style={{marginTop: 10, color: demoColors.muted, fontSize: 23}}>Se quiser, separo quantos estão com kit e quantos estão sem kit.</div>
          </ChatMessage>
          <ChatMessage side="user" style={{marginTop: 24, ...entrance(frame, fps, 176, 16)}}>
            Quantos com kit?
          </ChatMessage>
          <ChatMessage side="assistant" style={{marginTop: 24, ...entrance(frame, fps, 226, 16)}}>
            <div>Você tem <strong>{inventory.mountedQuantity} {inventory.model}</strong> montados com kit.</div>
            <div style={{marginTop: 10, color: demoColors.muted, fontSize: 23}}>
              {hasCompleteMountedBreakdown
                ? "Posso mostrar em quais configurações eles estão."
                : "Posso mostrar uma configuração do modelo com saldo montado."}
            </div>
          </ChatMessage>
          <ChatMessage side="user" style={{marginTop: 24, ...entrance(frame, fps, 326, 16)}}>Sim</ChatMessage>
          <ChatMessage side="assistant" style={{marginTop: 24, ...entrance(frame, fps, 362, 16)}}>
            <div>
              {hasCompleteMountedBreakdown
                ? <>Esses <strong>{inventory.mountedQuantity} {inventory.model}</strong> montados com kit estão distribuídos nestas configurações:</>
                : <>Esta é uma configuração do modelo <strong>{inventory.model}</strong> com saldo montado:</>}
            </div>
            <div style={{marginTop: 20, overflow: "hidden", border: `1px solid ${demoColors.border}`, borderRadius: 20, background: "#faf9f6"}}>
              <div style={{padding: "15px 20px", color: "#9a6a28", fontSize: 15, fontWeight: 950, letterSpacing: 2.2, ...entrance(frame, fps, 368, 12)}}>CONFIGURAÇÕES COM KIT</div>
              <div style={{padding: "0 20px 12px", color: demoColors.muted, fontSize: 17, fontWeight: 700, ...entrance(frame, fps, 374, 12)}}>Configurações do modelo {inventory.model}</div>
              {mountedConfigurationBreakdown.configurations.map((configuration, index) => (
                <div
                  key={configuration.code}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 22,
                    padding: "16px 20px",
                    borderTop: `1px solid ${demoColors.border}`,
                    background: "white",
                    ...entrance(frame, fps, 380 + index * 7, 12),
                  }}
                >
                  <div>
                    <div style={{fontSize: 20, fontWeight: 900}}>Cód. {configuration.code}</div>
                    <div style={{marginTop: 5, color: demoColors.muted, fontSize: 17}}>{configuration.description}</div>
                  </div>
                  <div style={{minWidth: 82, textAlign: "center"}}>
                    <div style={{fontSize: 31, fontWeight: 950}}>{configuration.quantity}</div>
                    <div style={{color: demoColors.muted, fontSize: 13, fontWeight: 850}}>ESTOQUE</div>
                  </div>
                </div>
              ))}
            </div>
          </ChatMessage>
        </div>
      </AssistantChrome>
    </div>
  );
}
