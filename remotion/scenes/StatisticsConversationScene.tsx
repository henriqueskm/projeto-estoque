import {interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {AssistantChrome, ChatMessage, demoColors} from "../components/AssistantChrome";
import {assistantDemoFixture} from "../data/assistant-demo-fixture";
import {entrance, fadeWindow} from "../utils/animation";

const sceneDuration = 270;

export function StatisticsConversationScene() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const statistics = assistantDemoFixture.statistics;
  const scroll = interpolate(frame, [0, 225], [0, -220], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{position: "absolute", inset: 0, opacity: fadeWindow(frame, sceneDuration, 24, 24), background: "radial-gradient(circle at 72% 15%, #2f3a41 0%, #171d21 58%, #0d1114 100%)"}}>
      <AssistantChrome>
        <div style={{position: "absolute", inset: 0, padding: "38px 54px 70px", transform: `translateY(${scroll}px)`}}>
          <ChatMessage side="user" style={entrance(frame, fps, 8)}>
            Qual Servo com kit mais saiu nos últimos {statistics.periodDays} dias?
          </ChatMessage>
          <ChatMessage side="assistant" style={{marginTop: 24, ...entrance(frame, fps, 42)}}>
            <div>Considerando as <strong>saídas externas</strong> dos últimos {statistics.periodDays} dias, o <strong>Cód. {statistics.leadingCode}</strong> ficou em primeiro entre Servos com kit, com <strong>{statistics.leadingQuantity} unidades</strong>.</div>
            <div style={{marginTop: 10, color: demoColors.muted, fontSize: 23}}>Posso mostrar o ranking das cinco configurações com mais saídas.</div>
          </ChatMessage>
          <ChatMessage side="user" style={{marginTop: 24, ...entrance(frame, fps, 104)}}>Sim</ChatMessage>
          <ChatMessage side="assistant" style={{marginTop: 24, ...entrance(frame, fps, 138)}}>
            <div style={{width: 880, maxWidth: "100%", overflow: "hidden", border: `1px solid ${demoColors.border}`, borderRadius: 22, background: "#faf9f6"}}>
              <div style={{padding: "16px 20px", color: "#9a6a28", fontSize: 15, fontWeight: 950, letterSpacing: 2.1}}>ESTATÍSTICAS · ÚLTIMOS {statistics.periodDays} DIAS</div>
              <div style={{padding: "0 20px 17px", fontSize: 27, fontWeight: 950}}>Ranking · Servos com kit</div>
              <div style={{display: "grid", gridTemplateColumns: "58px 1fr 120px", alignItems: "center", gap: 16, padding: "18px 20px", borderTop: `1px solid ${demoColors.border}`, background: "white"}}>
                <div style={{display: "grid", width: 48, height: 48, placeItems: "center", borderRadius: 15, background: "#f5e4be", color: "#8a591b", fontSize: 19, fontWeight: 950}}>1º</div>
                <div>
                  <div style={{fontSize: 22, fontWeight: 950}}>Cód. {statistics.leadingCode}</div>
                  <div style={{marginTop: 4, color: demoColors.muted, fontSize: 17}}>{statistics.leadingDescription}</div>
                </div>
                <div style={{textAlign: "right"}}>
                  <div style={{fontSize: 34, fontWeight: 950}}>{statistics.leadingQuantity}</div>
                  <div style={{color: demoColors.muted, fontSize: 13, fontWeight: 850}}>SAÍDAS</div>
                </div>
              </div>
              <div style={{padding: "13px 20px", color: demoColors.muted, fontSize: 15, fontWeight: 700}}>Ranking oficial com cinco configurações</div>
            </div>
          </ChatMessage>
        </div>
      </AssistantChrome>
    </div>
  );
}
