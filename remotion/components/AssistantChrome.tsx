import type {CSSProperties, ReactNode} from "react";

const colors = {
  charcoal: "#171d21",
  gold: "#d99a3d",
  paper: "#f6f5f1",
  text: "#20252a",
  muted: "#667078",
  border: "#d9d8d2",
} as const;

export function AssistantChrome({children}: {children: ReactNode}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 54,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: 38,
        background: colors.paper,
        boxShadow: "0 30px 100px rgba(0,0,0,0.34)",
      }}
    >
      <header
        style={{
          height: 112,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 42px",
          color: "white",
          background: colors.charcoal,
          borderBottom: `2px solid ${colors.gold}`,
        }}
      >
        <div style={{display: "flex", alignItems: "center", gap: 20}}>
          <div
            style={{
              width: 58,
              height: 58,
              display: "grid",
              placeItems: "center",
              border: `2px solid ${colors.gold}`,
              borderRadius: "50%",
              color: colors.gold,
              fontSize: 23,
              fontWeight: 950,
              letterSpacing: -2,
            }}
          >
            NK
          </div>
          <div>
            <div style={{fontSize: 29, fontWeight: 950, letterSpacing: 0.2}}>Assistente NK</div>
            <div style={{marginTop: 4, color: colors.gold, fontSize: 15, fontWeight: 850, letterSpacing: 2.8}}>
              DADOS OFICIAIS DO ESTOQUE
            </div>
          </div>
        </div>
        <div style={{color: "#aeb6bb", fontSize: 18, fontWeight: 700}}>Conversa contextual</div>
      </header>
      <main style={{position: "relative", flex: 1, overflow: "hidden"}}>{children}</main>
      <footer
        style={{
          height: 88,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0 32px",
          borderTop: `1px solid ${colors.border}`,
          background: "rgba(255,255,255,0.96)",
        }}
      >
        <div style={{flex: 1, padding: "18px 24px", border: `1px solid ${colors.border}`, borderRadius: 18, color: colors.muted, fontSize: 19}}>
          Digite uma mensagem...
        </div>
        <div style={{width: 54, height: 54, display: "grid", placeItems: "center", borderRadius: 17, background: "#b7a4f4", fontSize: 24}}>↗</div>
      </footer>
    </div>
  );
}

export function ChatMessage({
  side,
  children,
  style,
}: {
  side: "assistant" | "user";
  children: ReactNode;
  style?: CSSProperties;
}) {
  const isUser = side === "user";
  return (
    <div style={{display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", ...style}}>
      {!isUser ? (
        <div style={{width: 46, height: 46, marginRight: 14, marginTop: 5, display: "grid", placeItems: "center", borderRadius: "50%", background: colors.charcoal, color: colors.gold, fontSize: 16, fontWeight: 950}}>NK</div>
      ) : null}
      <div
        style={{
          maxWidth: isUser ? 820 : 1080,
          padding: isUser ? "20px 28px" : "22px 28px",
          border: isUser ? "none" : `1px solid ${colors.border}`,
          borderRadius: isUser ? "28px 28px 6px 28px" : "6px 28px 28px 28px",
          background: isUser ? colors.charcoal : "white",
          color: isUser ? "white" : colors.text,
          boxShadow: "0 10px 28px rgba(24,29,33,0.08)",
          fontSize: 28,
          fontWeight: 670,
          lineHeight: 1.38,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export const demoColors = colors;
