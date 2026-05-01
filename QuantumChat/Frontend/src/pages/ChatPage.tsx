import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import { usersApi, friendsApi, groupsApi, cryptoApi } from '../services/api'
import { useSignalR } from '../hooks/useSignalR'
import { b64ToBytes, deriveFriendWrapKey, deriveGroupWrapKey } from '../utils/crypto'
import { stopConnection } from '../services/signalr'
import Sidebar from '../components/sidebar/Sidebar'
import ChatWindow from '../components/chat/ChatWindow'
import WelcomePanel from '../components/chat/WelcomePanel'

export default function ChatPage() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)

  useSignalR()

  useEffect(() => {
    if (!user) return
    async function init() {
      try {
        const [friends, requests, groups] = await Promise.all([
          usersApi.getFriends(),
          friendsApi.getRequests(),
          groupsApi.getMyGroups(),
        ])
        useChatStore.getState().setFriends(friends)
        useChatStore.getState().setRequests(requests)
        useChatStore.getState().setGroups(groups)

        for (const f of friends) {
          try {
            const { sharedSecretB64 } = await cryptoApi.decapsulate(f.kemCiphertext)
            const wrapKey = await deriveFriendWrapKey(b64ToBytes(sharedSecretB64))
            const [, wrapped] = f.kemCiphertext.split('|')
            const wb = b64ToBytes(wrapped)
            const key = new Uint8Array(wrapKey.length)
            for (let i = 0; i < wrapKey.length; i++) key[i] = wrapKey[i] ^ wb[i]
            useChatStore.getState().setSharedKey(String(f.friendshipId), key)
          } catch (e) { console.warn('Friendship key failed:', e) }
        }

        for (const g of groups) {
          const me = g.members.find(m => m.userId === user!.userId) //
          if (!me?.kemCiphertext || me.kemCiphertext.startsWith('[')) continue
          try {
            const { sharedSecretB64 } = await cryptoApi.decapsulate(me.kemCiphertext)
            const wrapKey = await deriveGroupWrapKey(b64ToBytes(sharedSecretB64))
            const [, wrapped] = me.kemCiphertext.split('|')
            const wb = b64ToBytes(wrapped)
            const key = new Uint8Array(wrapKey.length)
            for (let i = 0; i < wrapKey.length; i++) key[i] = wrapKey[i] ^ wb[i]
            useChatStore.getState().setSharedKey(`group_${g.id}`, key)
          } catch (e) { console.warn('Group key failed:', e) }
        }
      } catch (e) {
        console.error('Init failed:', e)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [user?.userId]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleLogout() {
    stopConnection()
    logout()
    navigate('/login')
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0a0a0f]">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Establishing secure keys…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex bg-[#0a0a0f] overflow-hidden">
      <Sidebar onLogout={handleLogout} />
      <main className="flex-1 flex flex-col overflow-hidden">
        <ActiveChatView />
      </main>
    </div>
  )
}

function ActiveChatView() {
  const activeChat = useChatStore(s => s.activeChat)
  const [ready, setReady] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const keyId = activeChat
    ? activeChat.type === 'direct'
      ? String(activeChat.friend.friendshipId)
      : `group_${activeChat.group.id}`
    : null

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (!keyId) { setReady(false); return }

    // Check immediately
    if (useChatStore.getState().sharedKeys[keyId]) {
      setReady(true)
      return
    }

    // Key not ready yet — poll until it appears
    setReady(false)
    intervalRef.current = setInterval(() => {
      if (useChatStore.getState().sharedKeys[keyId]) {
        setReady(true)
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    }, 100)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [keyId]) // Only depend on keyId - not sharedKeys ref

  if (!activeChat) return <WelcomePanel />

  if (!ready) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0f]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Establishing shared key…</p>
          <p className="text-slate-600 text-xs mt-1">ML-KEM-768 + ECDH P-256 decapsulation</p>
        </div>
      </div>
    )
  }

  return <ChatWindow />
}
