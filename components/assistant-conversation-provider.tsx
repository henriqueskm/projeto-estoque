"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  assistantSessionStoragePrefix,
  clearAssistantSessionStorage,
  getAssistantSessionStorageKey,
  parseAssistantSession,
  serializeAssistantSession,
  type AssistantConversationMessage,
  type AssistantSessionState,
} from "@/lib/assistant-session";
import { emptyAssistantConversationContext } from "@/lib/assistant-conversation";
import type { AssistantConversationContext as AssistantConversationState } from "@/lib/assistant-types";

type PersistOptions = {
  scrollTop?: number;
};

type AssistantConversationContextValue = {
  isHydrated: boolean;
  conversationId: string;
  messages: AssistantConversationMessage[];
  setMessages: Dispatch<SetStateAction<AssistantConversationMessage[]>>;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  conversationContext: AssistantConversationState;
  setConversationContext: Dispatch<SetStateAction<AssistantConversationState>>;
  scrollTop: number;
  setScrollTop: Dispatch<SetStateAction<number>>;
  persistNow: (options?: PersistOptions) => void;
  resetConversation: () => void;
};

const AssistantConversationContext =
  createContext<AssistantConversationContextValue | null>(null);

function createEmptySession(): AssistantSessionState {
  return {
    conversationId: crypto.randomUUID(),
    messages: [],
    draft: "",
    conversationContext: emptyAssistantConversationContext(),
    scrollTop: 0,
  };
}

export function AssistantConversationProvider({
  children,
  userId,
}: {
  children: ReactNode;
  userId: string;
}) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<AssistantConversationMessage[]>(
    [],
  );
  const [draft, setDraft] = useState("");
  const [conversationContext, setConversationContext] =
    useState<AssistantConversationState>(emptyAssistantConversationContext);
  const [scrollTop, setScrollTop] = useState(0);
  const storageKey = useMemo(
    () => getAssistantSessionStorageKey(userId),
    [userId],
  );
  const sessionRef = useRef<AssistantSessionState | null>(null);
  const persistenceTimeoutRef = useRef<number | null>(null);
  const isSigningOutRef = useRef(false);

  const currentSession = useMemo<AssistantSessionState | null>(
    () =>
      conversationId
        ? {
            conversationId,
            messages,
            draft,
            conversationContext,
            scrollTop,
          }
        : null,
    [
      conversationId,
      draft,
      conversationContext,
      messages,
      scrollTop,
    ],
  );

  useEffect(() => {
    sessionRef.current = currentSession;
  }, [currentSession]);

  const writeSession = useCallback(
    (session: AssistantSessionState) => {
      if (isSigningOutRef.current) {
        return;
      }

      try {
        const serialized = serializeAssistantSession(session);

        if (serialized) {
          window.sessionStorage.setItem(storageKey, serialized);
        } else {
          window.sessionStorage.removeItem(storageKey);
        }
      } catch {
        // A conversa continua disponível em memória se o navegador bloquear
        // sessionStorage ou a cota da aba for atingida.
      }
    },
    [storageKey],
  );

  const persistNow = useCallback(
    (options?: PersistOptions) => {
      if (isSigningOutRef.current) {
        return;
      }

      const session = sessionRef.current;

      if (!session) {
        return;
      }

      writeSession({
        ...session,
        ...(options?.scrollTop !== undefined
          ? { scrollTop: Math.max(0, options.scrollTop) }
          : {}),
      });
    },
    [writeSession],
  );

  const clearAssistantSession = useCallback(() => {
    isSigningOutRef.current = true;

    if (persistenceTimeoutRef.current !== null) {
      window.clearTimeout(persistenceTimeoutRef.current);
      persistenceTimeoutRef.current = null;
    }

    const emptySession = createEmptySession();
    sessionRef.current = emptySession;
    setConversationId(emptySession.conversationId);
    setMessages([]);
    setDraft("");
    setConversationContext(emptyAssistantConversationContext());
    setScrollTop(0);

    try {
      clearAssistantSessionStorage(window.sessionStorage, userId);
    } catch {
      // O estado em memória permanece limpo mesmo quando o navegador bloqueia
      // o acesso ao sessionStorage.
    }
  }, [userId]);

  const resetConversation = useCallback(() => {
    const nextSession = createEmptySession();

    setConversationId(nextSession.conversationId);
    setMessages([]);
    setDraft("");
    setConversationContext(emptyAssistantConversationContext());
    setScrollTop(0);
    sessionRef.current = nextSession;
    writeSession(nextSession);
  }, [writeSession]);

  useEffect(() => {
    let isCancelled = false;
    let restoredSession: AssistantSessionState | null = null;

    try {
      for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = window.sessionStorage.key(index);

        if (
          key &&
          key.startsWith(`${assistantSessionStoragePrefix}:`) &&
          key.endsWith(`:${userId}`) &&
          key !== storageKey
        ) {
          window.sessionStorage.removeItem(key);
        }
      }

      const rawValue = window.sessionStorage.getItem(storageKey);

      if (rawValue) {
        restoredSession = parseAssistantSession(rawValue);

        if (!restoredSession) {
          window.sessionStorage.removeItem(storageKey);
        }
      }
    } catch {
      restoredSession = null;
    }

    const session = restoredSession ?? createEmptySession();

    window.queueMicrotask(() => {
      if (isCancelled || isSigningOutRef.current) {
        return;
      }

      setConversationId(session.conversationId);
      setMessages(session.messages);
      setDraft(session.draft);
      setConversationContext(session.conversationContext);
      setScrollTop(session.scrollTop);
      sessionRef.current = session;
      setIsHydrated(true);
    });

    return () => {
      isCancelled = true;
    };
  }, [storageKey, userId]);

  useEffect(() => {
    if (!isHydrated || !currentSession || isSigningOutRef.current) {
      return;
    }

    if (persistenceTimeoutRef.current !== null) {
      window.clearTimeout(persistenceTimeoutRef.current);
    }

    persistenceTimeoutRef.current = window.setTimeout(() => {
      persistenceTimeoutRef.current = null;

      if (isSigningOutRef.current) {
        return;
      }

      writeSession(currentSession);
    }, 300);

    return () => {
      if (persistenceTimeoutRef.current !== null) {
        window.clearTimeout(persistenceTimeoutRef.current);
        persistenceTimeoutRef.current = null;
      }
    };
  }, [currentSession, isHydrated, writeSession]);

  useEffect(() => {
    function handlePageHide() {
      persistNow();
    }

    function handleLogoutSubmit(event: SubmitEvent) {
      const form =
        event.target instanceof HTMLFormElement ? event.target : null;

      if (!form?.hasAttribute("data-assistant-session-logout")) {
        return;
      }

      clearAssistantSession();
    }

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("submit", handleLogoutSubmit, true);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("submit", handleLogoutSubmit, true);
    };
  }, [clearAssistantSession, persistNow]);

  const value = useMemo<AssistantConversationContextValue>(
    () => ({
      isHydrated,
      conversationId,
      messages,
      setMessages,
      draft,
      setDraft,
      conversationContext,
      setConversationContext,
      scrollTop,
      setScrollTop,
      persistNow,
      resetConversation,
    }),
    [
      conversationId,
      draft,
      isHydrated,
      conversationContext,
      messages,
      persistNow,
      resetConversation,
      scrollTop,
    ],
  );

  return (
    <AssistantConversationContext.Provider value={value}>
      {children}
    </AssistantConversationContext.Provider>
  );
}

export function useAssistantConversation() {
  const conversation = useContext(AssistantConversationContext);

  if (!conversation) {
    throw new Error(
      "useAssistantConversation must be used within AssistantConversationProvider.",
    );
  }

  return conversation;
}
