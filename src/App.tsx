import { useState, useCallback, useEffect, useRef, useMemo, type ChangeEvent } from 'react';
import type {
  Message,
  ToolLampState,
  ImageAttachment,
  ImageSsePayload,
  ConversationSummary,
} from './types';
import {
  deleteConversation,
  fetchConversationHistory,
  listConversations,
  sendMessageStream,
  stopAgent,
} from './api';
import type { RawSseEvent } from './api';
import { I18nProvider, LangToggle, useT, MessageKeys } from './i18n';
import {
  base64ToBlob,
  saveImage,
  loadConversationImages,
  deleteConversationImages,
  createObjectUrl,
  revokeAllObjectUrls,
  makeStorageKey,
} from './lib/imageStore';
import { saveSnapshot, loadSnapshot, deleteSnapshot } from './lib/chatUiStore';
import ToolIndicators from './components/ToolIndicators';
import ChatWindow from './components/ChatWindow';
import ChatInput from './components/ChatInput';
import type { FileInfo } from './components/ChatInput';
import ConversationSidebar from './components/ConversationSidebar';
import GitHubLink from './components/GitHubLink';
import DeployLink from './components/DeployLink';
import styles from './App.module.css';

const LAMP_IDS = ['commands', 'files', 'code_interpreter', 'browser'] as const;
type LampId = typeof LAMP_IDS[number];
const LAMP_ICONS: Record<string, string> = { commands: '⌨️', files: '📁', code_interpreter: '🐍', browser: '🌐' };

/**
 * Map an EdgeOne platform tool name to a lamp group.
 *
 * The runtime exposes fine-grained tools (e.g. `browser_fetch`,
 * `browser_screenshot`, `files_read`, `commands_run`,
 * `code_interpreter_python`). The header only has 4 lamps, so we collapse
 * each family by prefix / keyword. Returns null for tools that don't belong
 * to any lamp group (e.g. `web_search`, `load_skill`).
 */
function toolToLampId(toolName: string): LampId | null {
  const name = toolName.toLowerCase();
  if (name.startsWith('browser') || name.includes('browse')) return 'browser';
  if (name.startsWith('code_interpreter') || name.startsWith('code-interpreter') || name.startsWith('interpreter')) return 'code_interpreter';
  if (name.startsWith('files') || name.startsWith('file_') || name.startsWith('fs_') || name.startsWith('read_file') || name.startsWith('list_files')) return 'files';
  if (name.startsWith('commands') || name.startsWith('command_') || name.startsWith('cmd_') || name.startsWith('shell') || name === 'exec') return 'commands';
  if ((LAMP_IDS as readonly string[]).includes(name)) return name as LampId;
  return null;
}
const LAMP_I18N_KEYS: Record<string, string> = { commands: 'tool.commands', files: 'tool.files', code_interpreter: 'tool.codeRunner', browser: 'tool.browser' };

const CONVERSATION_ID_STORAGE_KEY = 'eo_conversation_id';
const EO_USER_ID_STORAGE_KEY = 'eo-uuid';
const CONVERSATIONS_PAGE_SIZE = 20;

/** Returns existing conversation ID from localStorage, or null if first visit */
function getExistingConversationId(): string | null {
  return localStorage.getItem(CONVERSATION_ID_STORAGE_KEY);
}

/** Returns existing or creates a new conversation ID */
function getOrCreateConversationId(): string {
  const cached = getExistingConversationId();
  if (cached) return cached;

  const conversationId = crypto.randomUUID();
  localStorage.setItem(CONVERSATION_ID_STORAGE_KEY, conversationId);
  return conversationId;
}

/**
 * Stable user-level identifier persisted in localStorage.
 * All conversations created in this browser are scoped to this UUID,
 * which is sent to the backend as `userId` for filtering and indexing.
 */
function getOrCreateEoUuid(): string {
  const cached = localStorage.getItem(EO_USER_ID_STORAGE_KEY);
  if (cached) return cached;

  const eoUuid = crypto.randomUUID();
  localStorage.setItem(EO_USER_ID_STORAGE_KEY, eoUuid);
  return eoUuid;
}

function isWebSearchToolEvent(event: RawSseEvent): boolean {
  if (event.eventType !== 'tool_called' || !event.data || typeof event.data !== 'object') {
    return false;
  }
  const tool = (event.data as { tool?: unknown }).tool;
  return tool === 'web_search' || tool === 'browser';
}

// Module-level dedup flag — outside React lifecycle, unaffected by StrictMode
let _historyFetchInFlight = false;

export default function App() {
  return (
    <I18nProvider>
      <LangToggle />
      <AppInner />
    </I18nProvider>
  );
}

function AppInner() {
  const { t } = useT();

  const buildLamps = useCallback((): ToolLampState[] => LAMP_IDS.map(id => ({
    id,
    label: t(LAMP_I18N_KEYS[id] as MessageKeys),
    icon: LAMP_ICONS[id],
    active: false,
    animKey: 0,
  })), [t]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [lamps, setLamps]       = useState<ToolLampState[]>(buildLamps);
  const [loading, setLoading]   = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  // Name of the skill currently being loaded by the SDK. null when no skill
  // is in flight. Set by the `skill_loaded` SSE event (singular — fires
  // when the SDK ACTUALLY loads a skill for this turn), auto-cleared
  // after a short interval so the pill animates out.
  const [skillInUse, setSkillInUse] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('');
  const [downloads, setDownloads] = useState<Array<{name:string,onClick:()=>void}>>([]);
  const [templateFiles, setTemplateFiles] = useState<FileInfo[]>([]);
  const [skillFiles, setSkillFiles] = useState<FileInfo[]>([]);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const skillInputRef = useRef<HTMLInputElement>(null);

  const handleTemplateUpload = (e: ChangeEvent<HTMLInputElement>) => {
    for (const file of e.target.files || []) {
      if (!file.name.endsWith('.yaml') && !file.name.endsWith('.yml')) {
        alert('仅支持 .yaml 模板文件');
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = (reader.result as string).split(',')[1] || '';
        setTemplateFiles(prev => [...prev, { name: file.name, content: b64, mimeType: 'text/yaml' }]);
      };
      reader.readAsDataURL(file);
    }
    if (e.target) e.target.value = '';
  };

  const handleSkillUpload = (e: ChangeEvent<HTMLInputElement>) => {
    for (const file of e.target.files || []) {
      if (!file.name.endsWith('.md')) {
        alert('仅支持 .md 技能文件');
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = (reader.result as string).split(',')[1] || '';
        setSkillFiles(prev => [...prev, { name: file.name.replace('.md',''), content: b64, mimeType: 'text/markdown' }]);
      };
      reader.readAsDataURL(file);
    }
    if (e.target) e.target.value = '';
  };

  // Conversation list state (left sidebar)
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationsLoadingMore, setConversationsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [activeConversationId, setActiveConversationId] = useState<string>(() =>
    getOrCreateConversationId(),
  );

  // Stable user identifier — derived once, never changes for the lifetime of this browser
  const eoUuidRef = useRef<string>(getOrCreateEoUuid());

  // Update lamp labels when language changes
  useEffect(() => {
    setLamps(prev => prev.map(l => ({
      ...l,
      label: t(LAMP_I18N_KEYS[l.id] as MessageKeys),
    })));
  }, [t]);

  const botMsgIdRef = useRef<string>('');
  const abortCtrlRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string>(activeConversationId);
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Keep ref in sync with state — sendMessageStream and other callbacks read from ref
  useEffect(() => {
    conversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // Guard: don't overwrite snapshot during initial restore phase.
  // Only start persisting once user has interacted (sent a message).
  const initDoneRef = useRef(false);

  // Persist UI snapshot whenever messages change (debounced)
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (messages.length === 0) return;
    if (!initDoneRef.current) return; // Skip snapshot save during restore phase

    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      saveSnapshot(conversationIdRef.current, messages);
    }, 500);

    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    };
  }, [messages]);

  /**
   * Load a conversation's messages, snapshot and image cache and put them on screen.
   * Used both for the initial restore and for switching to another conversation.
   */
  const loadConversation = useCallback(async (convId: string) => {
    setHistoryLoading(true);
    setMessages([]);
    // debug cleared;
    initDoneRef.current = false;

    revokeAllObjectUrls();

    try {
      const [history, snapshot, storedImages] = await Promise.all([
        fetchConversationHistory(convId, eoUuidRef.current),
        loadSnapshot(convId),
        loadConversationImages(convId),
      ]);

      const imageUrlMap = new Map<string, { url: string; mimeType: string; size: number; storageKey: string }>();
      for (const record of storedImages) {
        const url = createObjectUrl(record.storageKey, record.blob);
        imageUrlMap.set(record.imageId, {
          url,
          mimeType: record.mimeType,
          size: record.size,
          storageKey: record.storageKey,
        });
      }

      function rebuildImages(images: Message['images']): Message['images'] {
        if (!images || images.length === 0) return images;
        return images.map(img => {
          if (typeof img === 'string') return img;
          const urlInfo = imageUrlMap.get(img.id);
          return urlInfo ? { ...img, url: urlInfo.url, persistent: true } : img;
        });
      }

      let merged: Message[];
      if (snapshot.length > 0) {
        merged = snapshot.map(msg => ({
          ...msg,
          images: rebuildImages(msg.images),
        }));
      } else if (history.length > 0) {
        merged = history;
      } else {
        merged = [];
      }

      setMessages(merged);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  /** Refresh the sidebar conversation list — usually after sending or switching. */
  const refreshConversations = useCallback(async (mode: 'replace' | 'append' = 'replace', cursor?: string) => {
    if (mode === 'append') {
      setConversationsLoadingMore(true);
    } else {
      setConversationsLoading(true);
    }
    try {
      const res = await listConversations({
        userId: eoUuidRef.current,
        limit: CONVERSATIONS_PAGE_SIZE,
        order: 'desc',
        after: cursor,
      });

      setNextCursor(res.nextCursor);

      if (mode === 'append') {
        setConversations(prev => {
          const seen = new Set(prev.map(c => c.id));
          const merged = [...prev];
          for (const c of res.conversations) {
            if (!seen.has(c.id)) merged.push(c);
          }
          return merged;
        });
      } else {
        setConversations(res.conversations);
      }
    } finally {
      if (mode === 'append') {
        setConversationsLoadingMore(false);
      } else {
        setConversationsLoading(false);
      }
    }
  }, []);

  // Initial load: history (only if previously visited) + conversations list
  useEffect(() => {
    void refreshConversations('replace');

    if (!getExistingConversationId() || _historyFetchInFlight) {
      // First visit OR a sibling fetch is in flight — skip history fetch
      if (!getExistingConversationId()) setHistoryLoading(false);
      return;
    }

    _historyFetchInFlight = true;
    loadConversation(conversationIdRef.current).finally(() => {
      _historyFetchInFlight = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Update the current bot message's content via an updater function. */
  const updateBotMessage = useCallback((updater: (content: string) => string) => {
    setMessages(prev =>
      prev.map(m =>
        m.id === botMsgIdRef.current
          ? { ...m, content: updater(m.content) }
          : m
      )
    );
  }, []);

  const setBotActivity = useCallback((activity: Message['activity']) => {
    setMessages(prev =>
      prev.map(m =>
        m.id === botMsgIdRef.current
          ? { ...m, activity }
          : m
      )
    );
  }, []);

  const finishBotActivity = useCallback(() => {
    setMessages(prev => {
      let changed = false;
      const next = prev.map(m => {
        if (m.id === botMsgIdRef.current && m.activity?.status === 'active') {
          changed = true;
          return { ...m, activity: { ...m.activity, status: 'done' as const } };
        }
        return m;
      });
      return changed ? next : prev;
    });
  }, []);

  /** Clear the assistant message's `streaming` flag (hides the blinking caret). */
  const clearBotStreaming = useCallback(() => {
    setMessages(prev => {
      let changed = false;
      const next = prev.map(m => {
        if (m.id === botMsgIdRef.current && m.streaming) {
          changed = true;
          const { streaming, ...rest } = m;
          return rest;
        }
        return m;
      });
      return changed ? next : prev;
    });
  }, []);

  /** Handle an incoming image SSE event: persist to IndexedDB and append ref to message. */
  const handleImageEvent = useCallback(async (payload: ImageSsePayload) => {
    const { imageId, base64, mimeType = 'image/png', size } = payload;
    const convId = conversationIdRef.current;
    const msgId = botMsgIdRef.current;
    const storageKey = makeStorageKey(convId, imageId);

    const blob = base64ToBlob(base64, mimeType);
    const actualSize = size || blob.size;
    let persistent = false;

    try {
      await saveImage({
        conversationId: convId,
        messageId: msgId,
        imageId,
        blob,
        mimeType,
      });
      persistent = true;
    } catch (e) {
      console.warn('[image] IndexedDB save failed, using temporary URL:', e);
    }

    const url = persistent
      ? createObjectUrl(storageKey, blob)
      : URL.createObjectURL(blob);

    const attachment: ImageAttachment = {
      id: imageId,
      storageKey,
      url,
      mimeType,
      size: actualSize,
      createdAt: Date.now(),
      persistent,
    };

    setMessages(prev =>
      prev.map(m =>
        m.id === msgId
          ? { ...m, images: [...(m.images || []), attachment] }
          : m
      )
    );
  }, []);

  const finishStream = useCallback(() => {
    setLoading(false);
    abortCtrlRef.current = null;
  }, []);

  const handleSend = useCallback(async (text: string, files: Array<{name:string,content:string,mimeType:string}>) => {
    initDoneRef.current = true;
    setStatusText('Thinking...');

    // Reset tool/skill indicators for new conversation turn
    setLamps(prev => prev.map(l => ({ ...l, active: false })));
    setSkillInUse(null);
    setDownloads([]);

    const newMsgs: Message[] = [];

    // File cards: separate from text
    if (files.length) {
      files.forEach(f => {
        newMsgs.push({
          id: crypto.randomUUID(),
          role: 'user',
          content: `📄 ${f.name}`,
          timestamp: Date.now(),
        });
      });
    }

    // Text message: only if there's text
    if (text.trim()) {
      newMsgs.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
      });
    }

    const botMsgId = crypto.randomUUID();
    botMsgIdRef.current = botMsgId;
    const botMsg: Message = {
      id: botMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    };

    setMessages(prev => [...prev, ...newMsgs, botMsg]);
    setLoading(true);

    /**
     * Optimistic sidebar update — fires as soon as the backend emits its first
     * SSE event (matches ChatGPT's "new chat appears the moment streaming
     * starts" UX). For brand-new conversations we prepend a synthesized summary;
     * for existing ones we just bump them to the top.
     *
     * Server reconciliation still happens in onDone() via refreshConversations,
     * which can correct the title if the runtime later overrides it.
     */
    let sidebarPrimed = false;
    const cleanedText = text.replace(/\s+/g, ' ').trim();
    const optimisticTitle =
      cleanedText.length === 0 ? 'New chat'
        : cleanedText.length <= 8 ? cleanedText
          : `${cleanedText.slice(0, 8)}...`;

    const primeSidebar = () => {
      if (sidebarPrimed) return;
      sidebarPrimed = true;

      const convId = conversationIdRef.current;
      const now = Date.now();

      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === convId);
        if (idx === -1) {
          // Brand-new conversation — prepend.
          const summary: ConversationSummary = {
            id: convId,
            title: optimisticTitle,
            lastMessageAt: now,
            userId: eoUuidRef.current,
          };
          return [summary, ...prev];
        }
        // Existing conversation — bump to top and refresh timestamp.
        const next = [...prev];
        const [moved] = next.splice(idx, 1);
        next.unshift({ ...moved, lastMessageAt: now });
        return next;
      });
    };

    const ctrl = sendMessageStream(text, {
      onTextDelta(delta) {
        finishBotActivity();
        updateBotMessage(content => content + delta);
      },

      onToolCalled(toolName) {
        const lampId = toolToLampId(toolName);
        if (!lampId) return;

        setLamps(prev =>
          prev.map(l =>
            l.id === lampId
              ? { ...l, active: true, animKey: l.animKey + 1 }
              : l
          )
        );
        // Lamp stays lit — cleared on next user message
      },

      onImage(payload) {
        finishBotActivity();
        handleImageEvent(payload);
      },

      onRawEvent(event) {
        // Every backend SSE frame flows through here, so this is the cheapest
        // hook for "first byte from backend" — covers text_delta, tool_called,
        // skills_available, debug_msg, image, etc.
        primeSidebar();

        if (!isWebSearchToolEvent(event)) {
          finishBotActivity();
        }

        // Detect WSA_API_KEY-missing tool errors. The Claude SDK surfaces
        // tool errors as a `debug_msg` whose `preview` is a serialized
        // tool-result blob — but the shape differs by SDK language:
        //   TypeScript SDK → JSON-style:  "type":"tool_result", "is_error":true
        //   Python SDK     → repr-style:  ToolResultBlock(..., is_error=None)
        // (Yes, the Python SDK leaves is_error=None even on actual tool
        // failures; the failure is signalled only by the error message
        // text itself.) So we cannot rely on is_error and instead match:
        //   1. the literal env var name "WSA_API_KEY" (stable across
        //      locales — it's an env-var, not a translatable string), AND
        //   2. a tool-result context marker that survives both shapes.
        // The context guard prevents a user prompt that literally contains
        // "WSA_API_KEY" from flipping the chip to error.
        // Not persisted: a refresh clears the chip; a successful retry
        // calls setBotActivity({ status: 'active' }) and clears errorCode.
        if (event.eventType === 'debug_msg') {
          const preview = (event.data as { preview?: string } | null)?.preview;
          if (
            typeof preview === 'string' &&
            preview.includes('WSA_API_KEY') &&
            (
              preview.includes('tool_result') ||
              preview.includes('tool_use_result') ||
              preview.includes('ToolResultBlock')
            )
          ) {
            setBotActivity({
              type: 'web_search',
              label: 'Web search unavailable',
              status: 'error',
              errorCode: 'wsa_missing',
            });
          }
        }

        // Coalesce consecutive text_delta events into a single growing entry,
        // so a multi-paragraph response doesn't flood the debug panel with
        // hundreds of one-token rows.
        if (event.eventType === 'text_delta') {
          setStatusText('');
        }
        setStatusText('Thinking...');
        // debug events removed
        // Only react to `skill_loaded` (singular). The plural
        // `skills_available` / `skills_loaded` events fire on every
        // request as catalog/config announcements regardless of whether
        // the model actually uses a skill — they would flash the pill on
        // every chat. The event payload's `name` is the skill's identifier;
        // we surface it directly so the user sees WHICH skill is loading.
        if (event.eventType === 'skill_loaded') {
          const name =
            (event.data as { name?: unknown } | null)?.name;
          if (typeof name === 'string' && name.length > 0) {
            setSkillInUse(name);
            // Skill indicator persists — cleared on next user message
          }
        }
      },

      onFileGenerated({ name, base64: b64, mime }) {
        const mimeMap: Record<string,string> = { xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf:'application/pdf', png:'image/png', html:'text/html' };
        const m = mimeMap[mime] || 'application/octet-stream';
        // Auto-download the file immediately
        const a = document.createElement('a');
        a.href = `data:${m};base64,${b64}`;
        a.download = name;
        a.click();
        // Also add to activity panel for re-download
        setDownloads(prev => [...prev, { name, onClick: () => {
          const a2 = document.createElement('a'); a2.href = `data:${m};base64,${b64}`; a2.download = name; a2.click();
        }}]);
      },

      onDone() {
        finishBotActivity();
        clearBotStreaming();
        finishStream();

        // Auto-evolve: trigger skill improvement check (fire-and-forget)
        const msgs = messagesRef.current;
        if (msgs && msgs.length > 1) {
          fetch('/skill-evolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversation_id: conversationIdRef.current,
              messages: msgs.map(m => ({ role: m.role, content: m.content })),
            }),
          }).catch(() => {}); // Silent — don't disrupt UX
        }

        // Reconcile with backend so the title (and any other fields the runtime
        // synthesized) reflect the server's authoritative state.
        void refreshConversations('replace');
      },

      onError() {
        finishBotActivity();
        clearBotStreaming();
        updateBotMessage(content => content || t("status.error"));
        finishStream();
      },
    }, conversationIdRef.current, { userMsgId: newMsgs[newMsgs.length - 1]?.id || '', botMsgId }, eoUuidRef.current, files.length > 0 ? files : undefined, templateFiles.length > 0 ? templateFiles : undefined, skillFiles.length > 0 ? skillFiles : undefined);

    // Templates & skills persist — user removes them manually from Activity panel

    abortCtrlRef.current = ctrl;
  }, [updateBotMessage, setBotActivity, finishBotActivity, clearBotStreaming, handleImageEvent, finishStream, refreshConversations, t]);

  const handleClearHistory = useCallback(() => {
    const oldConvId = conversationIdRef.current;

    // The trash button in ChatInput is the same affordance as the trash
    // icon on a sidebar item: it should DELETE the conversation entirely,
    // not just clear its messages. Using `clearConversationHistory` here
    // would leave the old conversation in the sidebar with an empty body
    // and a fallback "New chat" title — confusing for users who clicked
    // trash expecting "make this thread go away".
    //
    // Optimistically drop from the sidebar so the user sees the row
    // disappear immediately; the network call is fire-and-forget.
    setConversations(prev => prev.filter(c => c.id !== oldConvId));

    deleteConversation(oldConvId, eoUuidRef.current).then(ok => {
      if (!ok) {
        console.warn('[delete-conversation] backend request failed');
      }
    }).finally(() => {
      // Reconcile with backend in case state diverged.
      void refreshConversations('replace');
    });

    // Cleanup IndexedDB images and UI snapshot for old conversation
    revokeAllObjectUrls();
    deleteConversationImages(oldConvId).catch(() => {});
    deleteSnapshot(oldConvId).catch(() => {});

    const newId = crypto.randomUUID();
    localStorage.setItem(CONVERSATION_ID_STORAGE_KEY, newId);
    conversationIdRef.current = newId;
    setActiveConversationId(newId);
    setMessages([]);
    // debug cleared;
    setStatusText('');
    initDoneRef.current = false;
  }, [refreshConversations]);

  const handleStop = useCallback(() => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
      abortCtrlRef.current = null;
    }

    finishBotActivity();
    // Clear the in-bubble blinking caret. onDone/onError normally do this,
    // but fetch.abort() throws AbortError that sendMessageStream silently
    // swallows — neither callback fires, so we have to do it here too.
    clearBotStreaming();
    updateBotMessage(content => content ? content + '\n\n' + t("status.stopped") : t("status.stopped"));
    setLoading(false);

    stopAgent(conversationIdRef.current).then(ok => {
      if (!ok) {
        updateBotMessage(content => content + '\n\n' + t("status.backendError"));
      }
    });
  }, [finishBotActivity, clearBotStreaming, updateBotMessage, t]);

  /** User clicked a conversation in the sidebar. */
  const handleSelectConversation = useCallback((id: string) => {
    if (loading) return; // disabled while streaming
    if (id === conversationIdRef.current) return;

    localStorage.setItem(CONVERSATION_ID_STORAGE_KEY, id);
    conversationIdRef.current = id;
    setActiveConversationId(id);
    setStatusText('');
    void loadConversation(id);
  }, [loading, loadConversation]);

  /** User clicked "New chat" in the sidebar. */
  const handleCreateConversation = useCallback(() => {
    if (loading) return;

    revokeAllObjectUrls();

    const newId = crypto.randomUUID();
    localStorage.setItem(CONVERSATION_ID_STORAGE_KEY, newId);
    conversationIdRef.current = newId;
    setActiveConversationId(newId);
    setMessages([]);
    // debug cleared;
    setStatusText('');
    initDoneRef.current = false;
    setHistoryLoading(false);
  }, [loading]);

  const handleLoadMoreConversations = useCallback(() => {
    if (!nextCursor || conversationsLoadingMore) return;
    void refreshConversations('append', nextCursor);
  }, [nextCursor, conversationsLoadingMore, refreshConversations]);

  /**
   * User clicked the trash icon on a sidebar item.
   *
   * Optimistic delete: immediately remove the item from local UI state and
   * fire-and-forget the backend request. We don't await or block the user —
   * if the network call fails, we log it but don't roll back, since reloading
   * the page will reconcile via /conversations anyway.
   */
  const handleDeleteConversation = useCallback((id: string) => {
    if (loading) return;        // never delete mid-stream
    if (!id) return;

    const confirmed = window.confirm(t('sidebar.deleteConfirm'));
    if (!confirmed) return;

    const isActive = id === conversationIdRef.current;

    // 1. Optimistically drop from sidebar.
    setConversations(prev => prev.filter(c => c.id !== id));

    // 2. If it was the active conversation, swap to a fresh empty one
    //    so the chat panel doesn't keep rendering stale messages.
    if (isActive) {
      revokeAllObjectUrls();
      const newId = crypto.randomUUID();
      localStorage.setItem(CONVERSATION_ID_STORAGE_KEY, newId);
      conversationIdRef.current = newId;
      setActiveConversationId(newId);
      setMessages([]);
      // debug cleared;
      setStatusText('');
      initDoneRef.current = false;
      setHistoryLoading(false);
    }

    // 3. Best-effort cleanup of local caches — user doesn't wait on these.
    void deleteSnapshot(id).catch(() => {});
    void deleteConversationImages(id).catch(() => {});

    // 4. Fire-and-forget backend delete. If it fails the user can refresh.
    void deleteConversation(id, eoUuidRef.current).catch(e => {
      console.warn('[delete-conversation] backend request failed:', e);
    });
  }, [loading, t]);

  const sidebarHasMore = useMemo(() => Boolean(nextCursor), [nextCursor]);

  return (
    <div className={styles.shell}>
      <div className={styles.blob1} />
      <div className={styles.blob2} />

      <div className={styles.stage}>
        <ConversationSidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          loading={conversationsLoading}
          loadingMore={conversationsLoadingMore}
          hasMore={sidebarHasMore}
          disabled={loading}
          onSelect={handleSelectConversation}
          onCreate={handleCreateConversation}
          onLoadMore={handleLoadMoreConversations}
          onDelete={handleDeleteConversation}
        />

        <div className={styles.chatPanel}>
          <header className={styles.header}>
            <div className={styles.headerLeft}>
              <span className={styles.logo}>⬡</span>
              <span className={styles.title}>{t("app.title")}</span>
            </div>
            <ToolIndicators lamps={lamps} />
          </header>

          <div className={styles.chatWindowShell}>
            <ChatWindow messages={messages} loading={loading} />
            {historyLoading && messages.length === 0 && (
              <div className={styles.historyOverlay}>
                <div className={styles.historySpinner} />
              </div>
            )}
          </div>
          <ChatInput onSend={handleSend} onStop={handleStop} onClear={handleClearHistory} disabled={loading} />
        </div>

        {/* Slim activity panel — tools/skills/thinking flow only */}
        <div className={styles.activityPanel}>
          <div className={styles.activityHeader}>Activity</div>
          <div className={styles.activityList}>
            {statusText && (
              <div className={styles.activityItem}>
                <span className={`${styles.activityDot} ${styles.think}`} />
                {statusText}
              </div>
            )}
            {lamps.filter(l=>l.active).map(l=>(
              <div key={l.id} className={styles.activityItem}>
                <span className={`${styles.activityDot} ${styles.tool}`} />
                {l.icon} {l.label}
              </div>
            ))}
            {/* SDK-loaded skills */}
            {skillInUse && (
              <div className={styles.activityItem}>
                <span className={`${styles.activityDot} ${styles.skill}`} />
                Skill: {skillInUse}
              </div>
            )}
            {/* Active user-uploaded skills */}
            {skillFiles.map((f,i)=>(
              <div key={'sk-'+i} className={styles.activityItem}>
                <span className={`${styles.activityDot} ${styles.skill}`} />
                🧩 {f.name}
              </div>
            ))}
            {/* Active user-uploaded templates */}
            {templateFiles.map((f,i)=>(
              <div key={'tpl-'+i} className={styles.activityItem}>
                <span className={`${styles.activityDot} ${styles.skill}`} />
                📋 {f.name}
              </div>
            ))}
            {downloads.map((d,i)=>(
              <button key={i} className={styles.downloadBtn} onClick={d.onClick}>
                📥 {d.name}
              </button>
            ))}
          </div>
          {/* Template upload section */}
          <div style={{borderTop:'1px solid var(--border-color)',padding:'10px 14px',flexShrink:0}}>
            <div style={{fontSize:'.65rem',fontWeight:600,color:'var(--text-secondary)',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'.04em'}}>📋 Templates</div>
            <input ref={templateInputRef} type="file" accept=".yaml,.yml" onChange={handleTemplateUpload} style={{display:'none'}} />
            <button
              onClick={() => templateInputRef.current?.click()}
              disabled={loading}
              style={{
                width:'100%',padding:'5px 10px',borderRadius:'var(--radius-sm)',
                border:'1px dashed var(--border-color)',background:'transparent',
                color:'var(--text-muted)',fontSize:'.62rem',cursor:'pointer',
                fontFamily:'var(--font-code)',textAlign:'center'
              }}>
              + Upload .yaml template
            </button>
            {templateFiles.map((f,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:'4px',marginTop:'4px',fontSize:'.6rem',color:'var(--text-secondary)'}}>
                📄 {f.name}
                <button onClick={()=>setTemplateFiles(prev=>prev.filter((_,j)=>j!==i))} style={{marginLeft:'auto',background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer'}}>×</button>
              </div>
            ))}
            {templateFiles.length===0 && (
              <div style={{fontSize:'.55rem',color:'var(--text-muted)',marginTop:'4px'}}>默认: sales, finance, HR, ops, marketing</div>
            )}
          </div>
          {/* Skills upload section */}
          <div style={{borderTop:'1px solid var(--border-color)',padding:'10px 14px',flexShrink:0}}>
            <div style={{fontSize:'.65rem',fontWeight:600,color:'var(--text-secondary)',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'.04em'}}>🧩 Skills</div>
            <input ref={skillInputRef} type="file" accept=".md" onChange={handleSkillUpload} style={{display:'none'}} />
            <button
              onClick={() => skillInputRef.current?.click()}
              disabled={loading}
              style={{
                width:'100%',padding:'5px 10px',borderRadius:'var(--radius-sm)',
                border:'1px dashed var(--border-color)',background:'transparent',
                color:'var(--text-muted)',fontSize:'.62rem',cursor:'pointer',
                fontFamily:'var(--font-code)',textAlign:'center'
              }}>
              + Upload .md skill
            </button>
            {skillFiles.map((f,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:'4px',marginTop:'4px',fontSize:'.6rem',color:'var(--text-secondary)'}}>
                🧩 {f.name}
                <button onClick={()=>setSkillFiles(prev=>prev.filter((_,j)=>j!==i))} style={{marginLeft:'auto',background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer'}}>×</button>
              </div>
            ))}
            {skillFiles.length===0 && (
              <div style={{fontSize:'.55rem',color:'var(--text-muted)',marginTop:'4px'}}>默认: chatbi-analysis, clean-data-xls 等</div>
            )}
          </div>
        </div>
      </div>
      <GitHubLink />
      <DeployLink />
    </div>
  );
}
