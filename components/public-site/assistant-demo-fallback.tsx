import {DeviceFrameMobile} from "@/components/public-site/device-frame";

export function AssistantDemoFallback() {
  return (
    <div className="assistant-demo-fallback" data-assistant-demo-fallback>
      <DeviceFrameMobile
        src="/presentation/screenshots/assistant/presentation-assistant-context-mobile.png"
        alt="Conversa contextual da Assistente NK sobre saldo de Servos com kit"
        width={1170}
        height={2532}
      />
      <DeviceFrameMobile
        src="/presentation/screenshots/assistant/presentation-assistant-statistics-mobile.png"
        alt="Assistente NK respondendo uma consulta estatística com ranking oficial"
        width={1170}
        height={2532}
        className="assistant-frame-secondary"
      />
    </div>
  );
}
