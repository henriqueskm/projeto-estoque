"use client";

import dynamic from "next/dynamic";
import {useEffect, useRef, useState} from "react";
import {AssistantDemoFallback} from "@/components/public-site/assistant-demo-fallback";

const AssistantDemoRuntime = dynamic(
  () => import("@/components/public-site/assistant-demo-runtime"),
  {ssr: false, loading: () => <AssistantDemoFallback />},
);

export default function AssistantDemoPlayer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canAnimate, setCanAnimate] = useState(false);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileViewport = window.matchMedia("(max-width: 39.99rem)");
    const updateCapability = () => setCanAnimate(!reducedMotion.matches && !mobileViewport.matches);

    updateCapability();
    reducedMotion.addEventListener("change", updateCapability);
    mobileViewport.addEventListener("change", updateCapability);

    return () => {
      reducedMotion.removeEventListener("change", updateCapability);
      mobileViewport.removeEventListener("change", updateCapability);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !canAnimate) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      {rootMargin: "0px 0px -12% 0px", threshold: 0.35},
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [canAnimate]);

  return (
    <div ref={containerRef} className="assistant-demo-boundary" aria-label="Demonstração animada da Assistente NK">
      {canAnimate && isNearViewport ? <AssistantDemoRuntime /> : <AssistantDemoFallback />}
    </div>
  );
}
