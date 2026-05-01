import { useEffect } from 'react';
import { startConnection, stopConnection } from '../services/signalr';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import { aesDecrypt, b64ToBytes, bytesToB64, deriveFriendWrapKey, deriveGroupWrapKey } from '../utils/crypto';
import type { MessageDto, GroupMessageDto, FriendDto, FriendRequestDto, GroupDto } from '../types';
import { cryptoApi } from '../services/api';

export function useSignalR() {
  const token = useAuthStore(s => s.user?.token);

  useEffect(() => {
    if (!token) return;

    // Track if this effect instance is still active
    let active = true;

    async function connect() {
      try {
        const conn = await startConnection(token!);
        if (!active) return;

        // ── Helpers ──────────────────────────────────────────────────────────

        async function tryDecrypt(msg: MessageDto | GroupMessageDto, key: Uint8Array) {
          if (msg.messageType !== 'text') return undefined;
          try { return await aesDecrypt(key, msg.encryptedContent, msg.iv, msg.tag); }
          catch { return '[Unable to decrypt]'; }
        }

        function traceClient(title: string, values: Record<string, string>) {
          cryptoApi.trace(title, values);
        }

        function friendKey(friendId: number) {
          const s = useChatStore.getState();
          const f = s.friends.find(x => x.friend.id === friendId);
          return f ? s.getSharedKey(String(f.friendshipId)) : undefined;
        }

        // Remove any existing handlers before re-registering (prevents duplicates on reconnect)
        conn.off('ReceiveMessage');
        conn.off('MessageSent');
        conn.off('ReceiveGroupMessage');
        conn.off('FriendRequestReceived');
        conn.off('FriendRequestAccepted');
        conn.off('AddedToGroup');
        conn.off('GroupUpdated');
        conn.off('GroupDeleted');
        conn.off('RemovedFromGroup');
        conn.off('MemberRemoved');
        conn.off('MemberLeft');
        conn.off('UserPresence');
        conn.off('UserTyping');
        conn.off('GroupTyping');
        conn.off('MessagesRead');

        // ── Direct message IN ─────────────────────────────────────────────────
        conn.on('ReceiveMessage', async (msg: MessageDto) => {
          const key   = friendKey(msg.senderId);
          const plain = key ? await tryDecrypt(msg, key) : undefined;
          if (key && plain && plain !== '[Unable to decrypt]') {
            traceClient('RECEIVER FRIEND MESSAGE RECONSTRUCTION', {
              conversationType: 'friend',
              conversationId: String(msg.senderId),
              messageId: String(msg.id),
              senderId: String(msg.senderId),
              receiverId: String(msg.receiverId),
              receivedCiphertextB64: msg.encryptedContent,
              receivedIvB64: msg.iv,
              receivedTagB64: msg.tag,
              receiverKeyB64: bytesToB64(key),
              reconstructedPlaintext: plain,
              finalOutputPlaintext: plain,
            });
          }
          useChatStore.getState().appendMessage(`dm_${msg.senderId}`, { ...msg, plaintext: plain });
          
          // Show notification
          const sender = useChatStore.getState().friends.find(f => f.friend.id === msg.senderId);
          if (sender) {
            useChatStore.getState().addNotification({
              type: 'message',
              title: 'New Message',
              message: `${sender.friend.displayName} sent you a message`,
              senderName: sender.friend.displayName
            });
          }
        });

        // ── Direct message confirmed (sender echo) ────────────────────────────
        conn.on('MessageSent', async (msg: MessageDto) => {
          const key   = friendKey(msg.receiverId);
          const plain = key ? await tryDecrypt(msg, key) : undefined;
          useChatStore.getState().replaceOrAppendMessage(`dm_${msg.receiverId}`, { ...msg, plaintext: plain });
        });

        // ── Group message ─────────────────────────────────────────────────────
        conn.on('ReceiveGroupMessage', async (msg: GroupMessageDto) => {
          const key   = useChatStore.getState().getSharedKey(`group_${msg.groupId}`);
          const plain = key ? await tryDecrypt(msg, key) : undefined;
          if (key && plain && plain !== '[Unable to decrypt]') {
            traceClient('RECEIVER GROUP MESSAGE RECONSTRUCTION', {
              conversationType: 'group',
              conversationId: String(msg.groupId),
              messageId: String(msg.id),
              senderId: String(msg.senderId),
              receivedCiphertextB64: msg.encryptedContent,
              receivedIvB64: msg.iv,
              receivedTagB64: msg.tag,
              receiverGroupKeyB64: bytesToB64(key),
              reconstructedPlaintext: plain,
              finalOutputPlaintext: plain,
            });
          }
          useChatStore.getState().replaceOrAppendGroupMessage(msg.groupId, { ...msg, plaintext: plain });
          
          // Show notification
          const group = useChatStore.getState().groups.find(g => g.id === msg.groupId);
          if (group) {
            useChatStore.getState().addNotification({
              type: 'group_message',
              title: `Message in ${group.name}`,
              message: `${msg.senderDisplayName} sent a message`,
              senderName: msg.senderDisplayName,
              groupName: group.name
            });
          }
        });

        // ── Friend request received ───────────────────────────────────────────
        conn.on('FriendRequestReceived', (req: FriendRequestDto) => {
          const s = useChatStore.getState();
          if (!s.requests.find(r => r.id === req.id))
            s.setRequests([...s.requests, req]);
        });

        // ── Friend request accepted ───────────────────────────────────────────
        conn.on('FriendRequestAccepted', async (data: {
          friendshipId: number;
          friend: FriendDto['friend'];
          kemCiphertext: string;
        }) => {
          // Derive shared key immediately
          try {
            const { sharedSecretB64 } = await cryptoApi.decapsulate(data.kemCiphertext);
            const wrapKey     = await deriveFriendWrapKey(b64ToBytes(sharedSecretB64));
            const [, wrapped] = data.kemCiphertext.split('|');
            const wBytes      = b64ToBytes(wrapped);
            const key         = new Uint8Array(wrapKey.length);
            for (let i = 0; i < wrapKey.length; i++) key[i] = wrapKey[i] ^ wBytes[i];
            useChatStore.getState().setSharedKey(String(data.friendshipId), key);
          } catch (e) { console.error('[SignalR] Key derivation on accept failed:', e); }

          const s = useChatStore.getState();
          if (!s.friends.find(f => f.friendshipId === data.friendshipId)) {
            s.setFriends([...s.friends, {
              friendshipId: data.friendshipId,
              friend:       data.friend,
              kemCiphertext: data.kemCiphertext,
            }]);
          }
        });

        // ── Added to group ────────────────────────────────────────────────────
        conn.on('AddedToGroup', async (group: GroupDto) => {
          const s = useChatStore.getState();
          if (!s.groups.find(g => g.id === group.id))
            s.setGroups([...s.groups, group]);

          const myId    = useAuthStore.getState().user?.userId;
          const myMember = group.members.find(m => m.userId === myId);
          if (myMember?.kemCiphertext && !myMember.kemCiphertext.startsWith('[')) {
            try {
              const { sharedSecretB64 } = await cryptoApi.decapsulate(myMember.kemCiphertext);
              const wrapKey  = await deriveGroupWrapKey(b64ToBytes(sharedSecretB64));
              const [, wPart] = myMember.kemCiphertext.split('|');
              const wrapped  = b64ToBytes(wPart);
              const key      = new Uint8Array(wrapKey.length);
              for (let i = 0; i < wrapKey.length; i++) key[i] = wrapKey[i] ^ wrapped[i];
              useChatStore.getState().setSharedKey(`group_${group.id}`, key);
            } catch (e) { console.error('[SignalR] Group key on AddedToGroup failed:', e); }
          }
        });

        // ── Removed from group ────────────────────────────────────────────────
        conn.on('RemovedFromGroup', (data: { groupId: number; groupName: string }) => {
          const s = useChatStore.getState();
          s.setGroups(s.groups.filter(g => g.id !== data.groupId));
          s.addGroupMessages(data.groupId, []); // Clear messages
          s.removeSharedKey(`group_${data.groupId}`);
          if (s.activeChat?.type === 'group' && s.activeChat.group.id === data.groupId) {
            s.setActiveChat(null);
          }
          
          s.addNotification({
            type: 'removed_from_group',
            title: 'Removed from Group',
            message: `You were removed from ${data.groupName}`,
            groupName: data.groupName
          });
        });

        conn.on('GroupUpdated', (group: GroupDto) => {
          const s = useChatStore.getState();
          const exists = s.groups.some(g => g.id === group.id);
          s.setGroups(exists
            ? s.groups.map(g => g.id === group.id ? group : g)
            : [...s.groups, group]
          );
          if (s.activeChat?.type === 'group' && s.activeChat.group.id === group.id) {
            s.setActiveChat({ type: 'group', group });
          }
        });

        conn.on('GroupDeleted', (data: { groupId: number; groupName: string }) => {
          const s = useChatStore.getState();
          s.setGroups(s.groups.filter(g => g.id !== data.groupId));
          s.addGroupMessages(data.groupId, []);
          s.removeSharedKey(`group_${data.groupId}`);
          if (s.activeChat?.type === 'group' && s.activeChat.group.id === data.groupId) {
            s.setActiveChat(null);
          }
          s.addNotification({
            type: 'removed_from_group',
            title: 'Group Deleted',
            message: `${data.groupName} was deleted`,
            groupName: data.groupName
          });
        });

        // ── Member removed from group (for other members) ────────────────────
        conn.on('MemberRemoved', (data: { groupId: number; userId: number; userName: string }) => {
          useChatStore.getState().addNotification({
            type: 'user_left_group',
            title: 'Member Removed',
            message: `${data.userName} was removed from the group`,
            senderName: data.userName
          });
        });

        // ── Member left group ─────────────────────────────────────────────────
        conn.on('MemberLeft', (data: { groupId: number; userId: number; userName: string }) => {
          useChatStore.getState().addNotification({
            type: 'user_left_group',
            title: 'Member Left',
            message: `${data.userName} left the group`,
            senderName: data.userName
          });
        });

        // ── Presence ──────────────────────────────────────────────────────────
        conn.on('UserPresence', (d: { userId: number; isOnline: boolean }) => {
          useChatStore.getState().updateFriendPresence(d.userId, d.isOnline);
        });

        // ── Typing ────────────────────────────────────────────────────────────
        conn.on('UserTyping', (d: { fromUserId: number; isTyping: boolean }) => {
          const key = `typing_${d.fromUserId}`;
          useChatStore.getState().setTyping(key, d.isTyping);
          if (d.isTyping) setTimeout(() => useChatStore.getState().setTyping(key, false), 4000);
        });

        conn.on('GroupTyping', (d: { fromUserId: number; groupId: number; isTyping: boolean }) => {
          const key = `group_${d.groupId}_${d.fromUserId}`;
          useChatStore.getState().setTyping(key, d.isTyping);
          if (d.isTyping) setTimeout(() => useChatStore.getState().setTyping(key, false), 4000);
        });

        conn.on('MessagesRead', (d: { byUserId: number }) => {
          useChatStore.getState().markRead(`dm_${d.byUserId}`);
        });

        console.log('[SignalR] All handlers registered');
      } catch (e) {
        console.error('[SignalR] Connection failed:', e);
      }
    }

    connect();

    // Cleanup: only stop if the token changes (logout/login), not on StrictMode double-invoke
    return () => {
      active = false;
      // Don't stop immediately — let the reconnect logic handle it
      // Only stop on actual unmount (component leaving DOM permanently)
    };
  }, [token]);

  // Stop on actual logout (token becomes null)
  useEffect(() => {
    if (!token) {
      stopConnection();
    }
  }, [token]);
}
