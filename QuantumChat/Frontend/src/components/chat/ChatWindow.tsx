import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../store/chatStore'
import { useAuthStore } from '../../store/authStore'
import { messagesApi, groupsApi, cryptoApi } from '../../services/api'
import { aesEncrypt, aesEncryptBytes, aesDecryptBytes, aesDecrypt, formatTime, formatFileSize, b64ToBytes, bytesToB64 } from '../../utils/crypto'
import { getConnection } from '../../services/signalr'
import type { MessageDto, GroupMessageDto, GroupDto } from '../../types'
import MitmDemo from './MitmDemo'

const EMPTY_ARRAY: MessageDto[] = []
const EMPTY_GROUP_ARRAY: GroupMessageDto[] = []

export default function ChatWindow() {
  const { user } = useAuthStore()

  // Safe: activeChat is guaranteed non-null here (ActiveChatView checks before rendering us)
  const activeChat = useChatStore(s => s.activeChat)!
  const isDirect   = activeChat.type === 'direct'
  const isGroup    = activeChat.type === 'group'
  const friendId   = isDirect ? activeChat.friend.friend.id : 0
  const groupId    = isGroup  ? activeChat.group.id : 0
  const keyId      = isDirect ? String(activeChat.friend.friendshipId) : `group_${groupId}`

  // All hooks called unconditionally - no conditionals inside hooks
  const sharedKey     = useChatStore(s => s.sharedKeys[keyId])
  const dmMessages    = useChatStore(s => s.messages[`dm_${friendId}`] ?? EMPTY_ARRAY)
  const groupMessages = useChatStore(s => s.groupMessages[groupId] ?? EMPTY_GROUP_ARRAY)
  const typingUsers   = useChatStore(s => s.typingUsers)
  const friends       = useChatStore(s => s.friends)

  const rawMsgs = isDirect ? dmMessages : groupMessages

  const [input, setInput]             = useState('')
  const [sending, setSending]         = useState(false)
  const [showMitm, setShowMitm]       = useState(false)
  const [showInfo, setShowInfo]       = useState(false)
  const [groupBusy, setGroupBusy]     = useState(false)
  const [downloading, setDownloading] = useState<Record<number, boolean>>({})
  const bottomRef   = useRef<HTMLDivElement>(null)
  const fileRef     = useRef<HTMLInputElement>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const targetName  = isDirect ? activeChat.friend.friend.displayName  : activeChat.group.name
  const targetColor = isDirect ? activeChat.friend.friend.avatarColor   : activeChat.group.avatarColor
  const isOnline    = isDirect ? activeChat.friend.friend.isOnline      : false
  const memberCount = isGroup  ? activeChat.group.members.length        : 0
  const isTyping    = isDirect ? !!typingUsers[`typing_${friendId}`]   : false
  const currentMember = isGroup ? activeChat.group.members.find(m => m.userId === user?.userId) : undefined
  const isCurrentUserAdmin = currentMember?.role === 'admin'

  // Load history when activeChat changes
  useEffect(() => {
    if (!sharedKey) return
    async function load() {
      try {
        if (isDirect) {
          const msgs = await messagesApi.getMessages(friendId)
          const cutoff = useChatStore.getState().getClearCutoff(`dm_${friendId}`)
          const visibleMsgs = cutoff ? msgs.filter(m => new Date(m.sentAt) > new Date(cutoff)) : msgs
          const dec = await Promise.all(visibleMsgs.map(async m => {
            if (m.messageType !== 'text') return m
            try {
              const plaintext = await aesDecrypt(sharedKey, m.encryptedContent, m.iv, m.tag)
              traceMessage('RECEIVER FRIEND MESSAGE RECONSTRUCTION', {
                messageId: String(m.id),
                senderId: String(m.senderId),
                receiverId: String(m.receiverId),
                receivedCiphertextB64: m.encryptedContent,
                receivedIvB64: m.iv,
                receivedTagB64: m.tag,
                receiverKeyB64: bytesToB64(sharedKey),
                reconstructedPlaintext: plaintext,
                finalOutputPlaintext: plaintext,
              })
              return { ...m, plaintext }
            }
            catch { return { ...m, plaintext: '[Decryption failed]' } }
          }))
          useChatStore.getState().addMessages(`dm_${friendId}`, dec)
        } else {
          const msgs = await groupsApi.getMessages(groupId)
          const cutoff = useChatStore.getState().getClearCutoff(`group_${groupId}`)
          const visibleMsgs = cutoff ? msgs.filter(m => new Date(m.sentAt) > new Date(cutoff)) : msgs
          const dec = await Promise.all(visibleMsgs.map(async m => {
            if (m.messageType !== 'text') return m
            try {
              const plaintext = await aesDecrypt(sharedKey, m.encryptedContent, m.iv, m.tag)
              traceMessage('RECEIVER GROUP MESSAGE RECONSTRUCTION', {
                messageId: String(m.id),
                senderId: String(m.senderId),
                receivedCiphertextB64: m.encryptedContent,
                receivedIvB64: m.iv,
                receivedTagB64: m.tag,
                receiverGroupKeyB64: bytesToB64(sharedKey),
                reconstructedPlaintext: plaintext,
                finalOutputPlaintext: plaintext,
              })
              return { ...m, plaintext }
            }
            catch { return { ...m, plaintext: '[Decryption failed]' } }
          }))
          useChatStore.getState().addGroupMessages(groupId, dec)
        }
      } catch (e) { console.error('Load failed:', e) }
    }
    load()
  }, [activeChat]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [rawMsgs.length])

  function sendTypingIndicator() {
    const conn = getConnection()
    if (!conn) return
    if (isDirect) {
      conn.invoke('Typing', friendId, true).catch(() => {})
      if (typingTimer.current) clearTimeout(typingTimer.current)
      typingTimer.current = setTimeout(() => conn.invoke('Typing', friendId, false).catch(() => {}), 2500)
    } else {
      conn.invoke('GroupTyping', groupId, true).catch(() => {})
    }
  }

  function clearCurrentChat() {
    if (!confirm('Clear this chat from your window? This will not delete it for other people.')) return
    if (isDirect) {
      useChatStore.getState().clearMessages(`dm_${friendId}`)
    } else {
      useChatStore.getState().clearGroupMessages(groupId)
    }
  }

  function traceMessage(title: string, values: Record<string, string>) {
    cryptoApi.trace(title, {
      conversationType: isDirect ? 'friend' : 'group',
      conversationId: isDirect ? String(friendId) : String(groupId),
      conversationName: targetName,
      ...values,
    })
  }

  async function sendText(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || !sharedKey || sending) return
    const plain = input.trim()
    setInput('')
    setSending(true)

    // Optimistic: show immediately with id=-1
    const now = new Date().toISOString()
    if (isDirect) {
      useChatStore.getState().appendMessage(`dm_${friendId}`, {
        id: -1, senderId: user!.userId, receiverId: friendId,
        senderUsername: user!.username, senderDisplayName: user!.displayName,
        senderAvatarColor: user!.avatarColor,
        encryptedContent: '', iv: '', tag: '', messageType: 'text',
        sentAt: now, isRead: false, plaintext: plain,
      })
    } else {
      useChatStore.getState().appendGroupMessage(groupId, {
        id: -1, groupId, senderId: user!.userId,
        senderUsername: user!.username, senderDisplayName: user!.displayName,
        senderAvatarColor: user!.avatarColor,
        encryptedContent: '', iv: '', tag: '', messageType: 'text',
        sentAt: now, plaintext: plain,
      })
    }

    try {
      const { encryptedContent, iv, tag } = await aesEncrypt(sharedKey, plain)
      traceMessage(isDirect ? 'SENDER FRIEND MESSAGE ENCRYPTION' : 'SENDER GROUP MESSAGE ENCRYPTION', {
        senderId: String(user!.userId),
        receiverId: isDirect ? String(friendId) : `group_${groupId}`,
        senderActualMessage: plain,
        senderAesKeyB64: bytesToB64(sharedKey),
        generatedCiphertextB64: encryptedContent,
        generatedIvB64: iv,
        generatedTagB64: tag,
      })
      if (isDirect) {
        await messagesApi.sendMessage({ receiverId: friendId, encryptedContent, iv, tag })
        // MessageSent SignalR event will replaceOrAppend with real message
      } else {
        const msg = await groupsApi.sendMessage(groupId, { groupId, encryptedContent, iv, tag })
        useChatStore.getState().replaceOrAppendGroupMessage(groupId, { ...msg, plaintext: plain })
      }
    } catch (e) {
      console.error('Send failed:', e)
      // Remove failed optimistic
      const key = isDirect ? `dm_${friendId}` : null
      if (key) {
        const cur = useChatStore.getState().messages[key] ?? []
        useChatStore.getState().addMessages(key, cur.filter(m => m.id !== -1))
      } else {
        const cur = useChatStore.getState().groupMessages[groupId] ?? []
        useChatStore.getState().addGroupMessages(groupId, cur.filter(m => m.id !== -1))
      }
    } finally { setSending(false) }
  }

  async function sendFile(file: File) {
    if (file.size > 10 * 1024 * 1024) { alert('File exceeds 10 MB'); return }
    if (!sharedKey) { alert('No shared key'); return }
    setSending(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { encryptedContent, iv, tag } = await aesEncryptBytes(sharedKey, bytes)
      const fd = new FormData()
      fd.append('file', new Blob([new Uint8Array(b64ToBytes(encryptedContent))]), file.name)
      fd.append('encryptedContent', encryptedContent)
      fd.append('iv', iv); fd.append('tag', tag)
      if (isDirect) {
        fd.append('receiverId', String(friendId))
        const msg = await messagesApi.sendFile(fd)
        useChatStore.getState().appendMessage(`dm_${friendId}`, { ...msg, plaintext: `📎 ${file.name}` })
      } else {
        const msg = await groupsApi.sendFile(groupId, fd)
        useChatStore.getState().appendGroupMessage(groupId, { ...msg, plaintext: `📎 ${file.name}` })
      }
    } catch (e) { console.error('File send failed:', e) }
    finally { setSending(false) }
  }

  async function downloadFile(msg: MessageDto | GroupMessageDto) {
    if (!sharedKey) { alert('No shared key'); return }
    setDownloading(d => ({ ...d, [msg.id]: true }))
    try {
      const url  = 'groupId' in msg ? `/api/groups/file/${msg.id}` : `/api/messages/file/${msg.id}`
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('qc_token')}` } })
      if (!resp.ok) throw new Error(`${resp.status}`)
      const iv2      = resp.headers.get('X-Encrypted-IV')  ?? msg.iv
      const tag2     = resp.headers.get('X-Encrypted-Tag') ?? msg.tag
      const rawName  = resp.headers.get('X-File-Name')
      const fileName = rawName ? decodeURIComponent(rawName) : (msg.fileName ?? 'file')
      const encBytes = new Uint8Array(await resp.arrayBuffer())
      const encB64   = btoa(String.fromCharCode(...encBytes))
      const plain    = await aesDecryptBytes(sharedKey, encB64, iv2, tag2)
      const a = document.createElement('a')
      a.href     = URL.createObjectURL(new Blob([new Uint8Array(plain)]))
      a.download = fileName
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) { alert('Download/decrypt failed') }
    finally { setDownloading(d => ({ ...d, [msg.id]: false })) }
  }

  function refreshGroupLocally(updatedGroup: GroupDto) {
    const s = useChatStore.getState()
    s.setGroups(s.groups.map(g => g.id === updatedGroup.id ? updatedGroup : g))
    s.setActiveChat({ type: 'group', group: updatedGroup })
  }

  async function transferAdminTo(userId: number) {
    if (!isGroup || groupBusy) return
    const member = activeChat.group.members.find(m => m.userId === userId)
    if (!member || !confirm(`Make ${member.displayName} the group admin?`)) return
    setGroupBusy(true)
    try {
      const updated = await groupsApi.transferAdmin(groupId, userId)
      refreshGroupLocally(updated)
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Could not transfer admin')
    } finally { setGroupBusy(false) }
  }

  async function removeGroupMember(userId: number) {
    if (!isGroup || groupBusy) return
    const member = activeChat.group.members.find(m => m.userId === userId)
    if (!member || !confirm(`Remove ${member.displayName} from this group?`)) return
    setGroupBusy(true)
    try {
      await groupsApi.removeMember(groupId, userId)
      refreshGroupLocally({
        ...activeChat.group,
        members: activeChat.group.members.filter(m => m.userId !== userId),
      })
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Could not remove member')
    } finally { setGroupBusy(false) }
  }

  async function addMembersToGroup() {
    if (!isGroup || groupBusy) return
    const existingIds = new Set(activeChat.group.members.map(m => m.userId))
    const candidates = friends
      .map(f => f.friend)
      .filter(f => !existingIds.has(f.id))

    if (candidates.length === 0) {
      alert('No friends available to add.')
      return
    }

    const choice = prompt(
      `Enter user ids to add, separated by commas:\n${candidates.map(f => `${f.id}: ${f.displayName}`).join('\n')}`
    )
    if (!choice) return

    const memberIds = choice.split(',')
      .map(x => Number(x.trim()))
      .filter(id => candidates.some(f => f.id === id))

    if (memberIds.length === 0) {
      alert('Choose at least one listed user id.')
      return
    }

    setGroupBusy(true)
    try {
      const updated = await groupsApi.addMembers(groupId, memberIds)
      refreshGroupLocally(updated)
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Could not add members')
    } finally { setGroupBusy(false) }
  }

  async function leaveGroup() {
    if (!isGroup || groupBusy) return
    let newAdminId: number | undefined
    if (isCurrentUserAdmin) {
      const candidates = activeChat.group.members.filter(m => m.userId !== user?.userId)
      if (candidates.length > 0) {
        const choice = prompt(
          `Choose new admin by user id before leaving:\n${candidates.map(m => `${m.userId}: ${m.displayName}`).join('\n')}`
        )
        if (!choice) return
        newAdminId = Number(choice)
        if (!candidates.some(m => m.userId === newAdminId)) {
          alert('Choose one of the listed member ids')
          return
        }
      }
    }
    if (!confirm('Leave this group?')) return
    setGroupBusy(true)
    try {
      await groupsApi.leaveGroup(groupId, newAdminId)
      const s = useChatStore.getState()
      s.setGroups(s.groups.filter(g => g.id !== groupId))
      s.addGroupMessages(groupId, [])
      s.removeSharedKey(`group_${groupId}`)
      s.setActiveChat(null)
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Could not leave group')
    } finally { setGroupBusy(false) }
  }

  async function deleteGroup() {
    if (!isGroup || groupBusy) return
    if (!confirm(`Delete ${activeChat.group.name}? This removes the group for every member.`)) return
    setGroupBusy(true)
    try {
      await groupsApi.deleteGroup(groupId)
      const s = useChatStore.getState()
      s.setGroups(s.groups.filter(g => g.id !== groupId))
      s.addGroupMessages(groupId, [])
      s.removeSharedKey(`group_${groupId}`)
      s.setActiveChat(null)
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Could not delete group')
    } finally { setGroupBusy(false) }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-950/80 backdrop-blur flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`w-10 h-10 ${isGroup ? 'rounded-xl' : 'rounded-full'} flex items-center justify-center text-white text-sm font-bold`}
              style={{ background: targetColor }}>
              {targetName[0]?.toUpperCase()}
            </div>
            {isDirect && isOnline && (
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 border-2 border-slate-950 rounded-full" />
            )}
          </div>
          <div>
            <p className="text-white font-semibold text-sm">{targetName}</p>
            <p className="text-slate-500 text-xs">
              {isDirect
                ? isTyping ? <span className="text-indigo-400 animate-pulse">typing…</span>
                  : isOnline ? 'Online' : `Last seen ${formatTime(activeChat.friend.friend.lastSeen)}`
                : `${memberCount} members`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="hidden sm:flex items-center gap-1.5 bg-emerald-900/30 border border-emerald-700/30 px-3 py-1 rounded-full mr-2">
            <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <span className="text-emerald-400 text-xs font-medium">E2E Encrypted</span>
          </div>
          <button onClick={() => setShowMitm(true)}
            className="text-slate-500 hover:text-indigo-400 px-2 py-1.5 rounded-lg hover:bg-slate-800 transition text-xs font-mono font-medium">
            MitM
          </button>
          <button onClick={clearCurrentChat}
            className="text-slate-500 hover:text-rose-300 px-2 py-1.5 rounded-lg hover:bg-slate-800 transition text-xs font-medium">
            Clear
          </button>
          {isGroup && (
            <button onClick={() => setShowInfo(v => !v)}
              className={`text-slate-500 hover:text-slate-300 p-2 rounded-lg hover:bg-slate-800 transition ${showInfo ? 'bg-slate-800 text-slate-300' : ''}`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Group info panel */}
      {showInfo && isGroup && (
        <div className="border-b border-slate-800 bg-slate-900/50 px-5 py-3 flex-shrink-0">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Members</p>
            <div className="flex items-center gap-2">
              <button onClick={leaveGroup} disabled={groupBusy}
                className="text-xs text-slate-400 hover:text-rose-300 disabled:opacity-40">
                Leave
              </button>
              {isCurrentUserAdmin && (
                <>
                  <button onClick={addMembersToGroup} disabled={groupBusy}
                    className="text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-40">
                    Add
                  </button>
                  <button onClick={deleteGroup} disabled={groupBusy}
                    className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-40">
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeChat.group.members.map(m => (
              <div key={m.userId} className="flex items-center gap-1.5 bg-slate-800 rounded-full px-2.5 py-1">
                <div className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                  style={{ background: m.avatarColor }}>{m.displayName[0]?.toUpperCase()}</div>
                <span className="text-xs text-slate-300">{m.displayName}</span>
                {isCurrentUserAdmin && m.userId !== user?.userId && (
                  <>
                    <button onClick={() => transferAdminTo(m.userId)} disabled={groupBusy}
                      className="text-[10px] text-indigo-300 hover:text-indigo-200 disabled:opacity-40">
                      Admin
                    </button>
                    {m.role !== 'admin' && (
                      <button onClick={() => removeGroupMember(m.userId)} disabled={groupBusy}
                        className="text-[10px] text-rose-300 hover:text-rose-200 disabled:opacity-40">
                        Remove
                      </button>
                    )}
                  </>
                )}
                {m.role === 'admin' && <span className="text-amber-400 text-[9px]">★</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4">
        {rawMsgs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center select-none">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
              style={{ background: `${targetColor}22` }}>
              <div className="w-7 h-7 rounded-full opacity-60" style={{ background: targetColor }} />
            </div>
            <p className="text-slate-500 text-sm">No messages yet</p>
            <p className="text-slate-700 text-xs mt-1">ML-KEM-768 + ECDH P-256 + AES-256-GCM</p>
          </div>
        )}
        <div className="space-y-0.5">
          {rawMsgs.map((msg, i) => {
            const isMine    = msg.senderId === user?.userId
            const prev      = rawMsgs[i - 1]
            const isConsec  = prev && prev.senderId === msg.senderId
            const isGrpMsg  = 'groupId' in msg
            const name      = isGrpMsg ? (msg as GroupMessageDto).senderDisplayName : (msg as MessageDto).senderDisplayName
            const color     = isGrpMsg ? (msg as GroupMessageDto).senderAvatarColor  : (msg as MessageDto).senderAvatarColor
            const plain     = (msg as any).plaintext
            const isFile    = msg.messageType !== 'text'
            const isPending = msg.id === -1

            return (
              <div key={`${msg.id}-${msg.sentAt}`}
                className={`flex ${isMine ? 'justify-end' : 'justify-start'} items-end gap-2 ${isConsec ? 'mt-0.5' : 'mt-3'}`}>
                {!isMine && isGroup && (
                  <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold text-white ${isConsec ? 'opacity-0' : ''}`}
                    style={{ background: color }}>
                    {!isConsec ? name[0]?.toUpperCase() : ''}
                  </div>
                )}
                <div className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} max-w-[70%]`}>
                  {!isConsec && !isMine && isGroup && (
                    <p className="text-[11px] text-slate-500 mb-1 px-1">{name}</p>
                  )}
                  <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words ${
                    isMine ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-slate-800 text-slate-100 rounded-bl-sm'
                  } ${isPending ? 'opacity-60' : ''}`}>
                    {!isFile ? (
                      <p className="whitespace-pre-wrap">{plain ?? '🔒 encrypted'}</p>
                    ) : (
                      <button onClick={() => !isPending && downloadFile(msg)}
                        disabled={downloading[msg.id] || isPending}
                        className="flex items-center gap-2.5 text-left w-full hover:opacity-80 transition-opacity">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isMine ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                          {downloading[msg.id]
                            ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            : <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                              </svg>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate max-w-[160px]">{msg.fileName}</p>
                          <p className="text-[11px] opacity-60">
                            {formatFileSize(msg.fileSize ?? 0)} · {downloading[msg.id] ? 'Decrypting…' : 'Tap to decrypt & save'}
                          </p>
                        </div>
                      </button>
                    )}
                  </div>
                  <p className={`text-[10px] text-slate-600 mt-0.5 px-1 ${isMine ? 'text-right' : ''}`}>
                    {isPending ? <span className="text-slate-700">sending…</span> : (
                      <>
                        {formatTime(msg.sentAt)}
                        {isMine && !isGrpMsg && (
                          <span className={`ml-1 ${(msg as MessageDto).isRead ? 'text-indigo-400' : ''}`}>
                            {(msg as MessageDto).isRead ? '✓✓' : '✓'}
                          </span>
                        )}
                      </>
                    )}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-slate-800 bg-slate-950/80 backdrop-blur flex-shrink-0">
        <form onSubmit={sendText} className="flex items-center gap-2">
          <input ref={fileRef} type="file" className="hidden"
            onChange={e => { if (e.target.files?.[0]) { sendFile(e.target.files[0]); e.target.value = '' } }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={sending}
            className="text-slate-500 hover:text-indigo-400 p-2.5 rounded-xl hover:bg-slate-800 transition flex-shrink-0 disabled:opacity-40">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
            </svg>
          </button>
          <input
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
            placeholder={sharedKey ? `Message ${targetName}…` : 'Key not ready…'}
            value={input} disabled={!sharedKey || sending}
            onChange={e => { setInput(e.target.value); sendTypingIndicator() }}
          />
          <button type="submit" disabled={!input.trim() || !sharedKey || sending}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 p-2.5 rounded-xl transition flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </form>
        <p className="text-[10px] text-slate-700 mt-1.5 px-1">
          🔒 ML-KEM-768 + ECDH P-256 + AES-256-GCM · end-to-end encrypted · IST
        </p>
      </div>

      {showMitm && <MitmDemo onClose={() => setShowMitm(false)} groupId={isGroup ? groupId : undefined} />}
    </div>
  )
}
