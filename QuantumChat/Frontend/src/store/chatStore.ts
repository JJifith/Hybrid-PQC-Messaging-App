import { create } from 'zustand';
import type { FriendDto, FriendRequestDto, GroupDto, MessageDto, GroupMessageDto, ChatTarget } from '../types';

const CLEARED_CHATS_KEY = 'qc-cleared-chats';

function loadClearedChats(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CLEARED_CHATS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveClearedChats(clearedChats: Record<string, string>) {
  localStorage.setItem(CLEARED_CHATS_KEY, JSON.stringify(clearedChats));
}

export interface Notification {
  id: string;
  type: 'message' | 'group_message' | 'removed_from_group' | 'user_left_group';
  title: string;
  message: string;
  senderName?: string;
  groupName?: string;
  createdAt: Date;
}

interface ChatState {
  friends:       FriendDto[];
  groups:        GroupDto[];
  requests:      FriendRequestDto[];
  activeChat:    ChatTarget | null;
  messages:      Record<string, MessageDto[]>;
  groupMessages: Record<number, GroupMessageDto[]>;
  typingUsers:   Record<string, boolean>;
  sharedKeys:    Record<string, Uint8Array>;
  notifications: Notification[];
  clearedChats:  Record<string, string>;

  setFriends:    (f: FriendDto[]) => void;
  setGroups:     (g: GroupDto[]) => void;
  setRequests:   (r: FriendRequestDto[]) => void;
  setActiveChat: (t: ChatTarget | null) => void;

  addMessages:    (key: string, msgs: MessageDto[]) => void;
  appendMessage:  (key: string, msg: MessageDto) => void;
  clearMessages:  (key: string) => void;
  /** Replace the optimistic entry (id === -1) with the confirmed msg, or append if not found */
  replaceOrAppendMessage: (key: string, msg: MessageDto) => void;

  addGroupMessages:    (gid: number, msgs: GroupMessageDto[]) => void;
  appendGroupMessage:  (gid: number, msg: GroupMessageDto) => void;
  clearGroupMessages:  (gid: number) => void;
  /** Replace the optimistic entry (id === -1) with confirmed msg, or append if not found */
  replaceOrAppendGroupMessage: (gid: number, msg: GroupMessageDto) => void;

  setTyping:    (key: string, val: boolean) => void;
  setSharedKey: (key: string, bytes: Uint8Array) => void;
  removeSharedKey: (key: string) => void;
  getSharedKey: (key: string) => Uint8Array | undefined;
  getClearCutoff: (key: string) => string | undefined;
  markRead:     (key: string) => void;
  updateFriendPresence: (userId: number, isOnline: boolean) => void;
  updateLastMessage:    (friendId: number, text: string) => void;

  // Notification actions
  addNotification: (notif: Omit<Notification, 'id' | 'createdAt'>) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  friends:       [],
  groups:        [],
  requests:      [],
  activeChat:    null,
  messages:      {},
  groupMessages: {},
  typingUsers:   {},
  sharedKeys:    {},
  notifications: [],
  clearedChats:  loadClearedChats(),

  setFriends:    (f) => set({ friends: f }),
  setGroups:     (g) => set({ groups: g }),
  setRequests:   (r) => set({ requests: r }),
  setActiveChat: (t) => set({ activeChat: t }),

  addMessages: (key, msgs) => set(s => ({
    messages: { ...s.messages, [key]: msgs }
  })),

  appendMessage: (key, msg) => set(s => {
    const existing = s.messages[key] ?? [];
    // Avoid duplicate real messages (same id already in list)
    if (msg.id !== -1 && existing.some(m => m.id === msg.id)) return s;
    return { messages: { ...s.messages, [key]: [...existing, msg] } };
  }),

  clearMessages: (key) => set(s => {
    const clearedChats = { ...s.clearedChats, [key]: new Date().toISOString() };
    saveClearedChats(clearedChats);
    return { messages: { ...s.messages, [key]: [] }, clearedChats };
  }),

  replaceOrAppendMessage: (key, msg) => set(s => {
    const existing = s.messages[key] ?? [];
    // Already have this real message id → skip
    if (existing.some(m => m.id === msg.id)) return s;
    // Replace the last optimistic (-1) entry if present
    const optIdx = existing.findLastIndex(m => m.id === -1);
    if (optIdx !== -1) {
      const updated = [...existing];
      updated[optIdx] = msg;
      return { messages: { ...s.messages, [key]: updated } };
    }
    // No optimistic entry — just append
    return { messages: { ...s.messages, [key]: [...existing, msg] } };
  }),

  addGroupMessages: (gid, msgs) => set(s => ({
    groupMessages: { ...s.groupMessages, [gid]: msgs }
  })),

  appendGroupMessage: (gid, msg) => set(s => {
    const existing = s.groupMessages[gid] ?? [];
    if (existing.some(m => m.id === msg.id)) return s;
    return { groupMessages: { ...s.groupMessages, [gid]: [...existing, msg] } };
  }),

  clearGroupMessages: (gid) => set(s => {
    const key = `group_${gid}`;
    const clearedChats = { ...s.clearedChats, [key]: new Date().toISOString() };
    saveClearedChats(clearedChats);
    return { groupMessages: { ...s.groupMessages, [gid]: [] }, clearedChats };
  }),

  replaceOrAppendGroupMessage: (gid, msg) => set(s => {
    const existing = s.groupMessages[gid] ?? [];
    if (existing.some(m => m.id === msg.id)) return s;
    const optIdx = existing.findLastIndex(m => m.id === -1);
    if (optIdx !== -1) {
      const updated = [...existing];
      updated[optIdx] = msg;
      return { groupMessages: { ...s.groupMessages, [gid]: updated } };
    }
    return { groupMessages: { ...s.groupMessages, [gid]: [...existing, msg] } };
  }),

  setTyping:    (key, val) => set(s => ({ typingUsers: { ...s.typingUsers, [key]: val } })),
  setSharedKey: (key, bytes) => set(s => ({ sharedKeys: { ...s.sharedKeys, [key]: bytes } })),
  removeSharedKey: (key) => set(s => {
    const next = { ...s.sharedKeys };
    delete next[key];
    return { sharedKeys: next };
  }),
  getSharedKey: (key) => get().sharedKeys[key],
  getClearCutoff: (key) => get().clearedChats[key],

  markRead: (key) => set(s => ({
    messages: {
      ...s.messages,
      [key]: (s.messages[key] ?? []).map(m => ({ ...m, isRead: true }))
    }
  })),

  updateFriendPresence: (userId, isOnline) => set(s => ({
    friends: s.friends.map(f =>
      f.friend.id === userId
        ? { ...f, friend: { ...f.friend, isOnline, lastSeen: new Date().toISOString() } }
        : f
    )
  })),

  updateLastMessage: (_friendId, _text) => {
    // Sidebar FriendsList reads from messages directly — no-op needed here
  },

  addNotification: (notif) => set(s => ({
    notifications: [...s.notifications, {
      id: Math.random().toString(36).substr(2, 9),
      createdAt: new Date(),
      ...notif
    }]
  })),

  removeNotification: (id) => set(s => ({
    notifications: s.notifications.filter(n => n.id !== id)
  })),

  clearNotifications: () => set({ notifications: [] }),

  reset: () => {
    localStorage.removeItem(CLEARED_CHATS_KEY);
    set({
      friends:       [],
      groups:        [],
      requests:      [],
      activeChat:    null,
      messages:      {},
      groupMessages: {},
      typingUsers:   {},
      sharedKeys:    {},
      notifications: [],
      clearedChats:  {},
    });
  },
}));
