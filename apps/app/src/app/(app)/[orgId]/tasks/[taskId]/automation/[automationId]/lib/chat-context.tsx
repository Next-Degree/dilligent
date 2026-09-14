'use client';

import { Chat } from '@ai-sdk/react';
import { DataUIPart, DefaultChatTransport } from 'ai';
import { useParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { mutate } from 'swr';
import { saveChatHistory } from '../actions/task-automation-actions';
import { type ChatUIMessage } from '../components/chat/types';
import { useTaskAutomationDataMapper } from './task-automation-store';
import { DataPart } from './types/data-parts';

type ChatDataMapper = (data: DataUIPart<DataPart>) => void;

interface ChatContextValue {
  chat: Chat<ChatUIMessage>;
  updateAutomationId: (newId: string) => void;
  /** Latest automation id. Safe to read while rendering. */
  automationId: string;
  /**
   * The same id in a mutable box, for callbacks that need the freshest value
   * without re-subscribing. Do not read this during render — use
   * `automationId` there instead.
   */
  automationIdRef: React.MutableRefObject<string>;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

interface ChatInstance {
  chat: Chat<ChatUIMessage>;
  setAutomationId: (next: string) => void;
  setDataMapper: (next: ChatDataMapper) => void;
}

/**
 * Builds the shared Chat exactly once. The automation id, the data mapper and
 * the save guard live in this closure instead of in refs: the Chat's callbacks
 * are created while the provider renders, and refs must not be read from
 * functions created during render.
 */
function createChatInstance({
  url,
  initialMessages,
  initialAutomationId,
  initialDataMapper,
}: {
  url: string;
  initialMessages: any[];
  initialAutomationId: string;
  initialDataMapper: ChatDataMapper;
}): ChatInstance {
  let automationId = initialAutomationId;
  let mapDataToState = initialDataMapper;
  let isSaving = false;

  const chat = new Chat<ChatUIMessage>({
    transport: new DefaultChatTransport({
      api: url,
    }),
    messages: initialMessages,
    onToolCall: () => mutate(`/api/auth/info`),
    onData: (data) => mapDataToState(data as DataUIPart<DataPart>),
    onError: (error) => {
      toast.error(`Communication error with the AI: ${error.message}`);
      console.error('Error sending message:', error);
    },
    onFinish: async (event) => {
      // Guard against concurrent saves
      if (isSaving) {
        return;
      }

      // Read the current automation ID from the closure (handles URL updates
      // via replaceState)
      const currentAutomationId = automationId;

      if (currentAutomationId === 'new') {
        return;
      }

      isSaving = true;
      try {
        const messagesToSave = event.messages;
        await saveChatHistory(currentAutomationId, messagesToSave || []);
      } finally {
        isSaving = false;
      }
    },
  });

  return {
    chat,
    setAutomationId: (next: string) => {
      automationId = next;
    },
    setDataMapper: (next: ChatDataMapper) => {
      mapDataToState = next;
    },
  };
}

export function ChatProvider({
  children,
  initialMessages = [],
}: {
  children: ReactNode;
  initialMessages?: any[];
}) {
  const mapDataToState = useTaskAutomationDataMapper();

  const baseUrl = process.env.NEXT_PUBLIC_ENTERPRISE_API_URL;
  const url = `${baseUrl}/api/tasks-automations/chat`;

  const { automationId: routeAutomationId } = useParams<{ automationId: string }>();

  // An ephemeral automation is promoted to a real id without a route change
  // (the URL is swapped with history.replaceState), so once a manual id has
  // been set it wins over the route param.
  const [manualAutomationId, setManualAutomationId] = useState<string | null>(null);
  const automationId = manualAutomationId ?? routeAutomationId;

  // Create the Chat instance once with initial messages
  const [chatInstance] = useState(() =>
    createChatInstance({
      url,
      initialMessages,
      initialAutomationId: automationId,
      initialDataMapper: mapDataToState,
    }),
  );

  // Mutable copy of the latest automation ID for consumers that read it from
  // callbacks (never during render).
  const automationIdRef = useRef(automationId);

  useEffect(() => {
    automationIdRef.current = automationId;
    chatInstance.setAutomationId(automationId);
  }, [chatInstance, automationId]);

  useEffect(() => {
    chatInstance.setDataMapper(mapDataToState);
  }, [chatInstance, mapDataToState]);

  // Function to update automation ID (called when ephemeral becomes real)
  const updateAutomationId = useCallback(
    (newId: string) => {
      // Update the out-of-band copies synchronously so an in-flight request
      // (e.g. the chat's onFinish save) sees the real id immediately.
      automationIdRef.current = newId;
      chatInstance.setAutomationId(newId);
      setManualAutomationId(newId);
    },
    [chatInstance],
  );

  return (
    <ChatContext.Provider
      value={{ chat: chatInstance.chat, updateAutomationId, automationId, automationIdRef }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useSharedChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useSharedChatContext must be used within a ChatProvider');
  }
  return context;
}
