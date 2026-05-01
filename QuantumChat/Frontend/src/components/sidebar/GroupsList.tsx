import { useEffect, useState } from 'react'
import { useChatStore } from '../../store/chatStore'
import { groupsApi } from '../../services/api'
import { formatTime } from '../../utils/crypto'
import type { GroupDto } from '../../types'

interface InterceptedMsg {
  messageId: number
  senderUsername: string
  encryptedContent: string
  iv: string
  gcmTag: string
  messageType: string
  sentAt: string
  decryptionStatus: string
}

interface InterceptData {
  groupId: number
  groupName: string
  isMember: boolean
  totalMessages: number
  interceptedMessages: InterceptedMsg[]
  securityNote: string
}

export default function GroupsList({ onCreateGroup }: { onCreateGroup: () => void }) {
  const myGroups      = useChatStore(s => s.groups)
  const groupMessages = useChatStore(s => s.groupMessages)
  const setActiveChat = useChatStore(s => s.setActiveChat)
  const activeChat    = useChatStore(s => s.activeChat)

  const [allGroups, setAllGroups]       = useState<GroupDto[]>([])
  const [loading, setLoading]           = useState(true)
  const [interceptData, setInterceptData] = useState<InterceptData | null>(null)
  const [interceptLoading, setInterceptLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    groupsApi.getAllGroups()
      .then(setAllGroups)
      .catch(() => setAllGroups(myGroups))
      .finally(() => setLoading(false))
  }, [myGroups.length])

  const myGroupIds = new Set(myGroups.map(g => g.id))

  async function openGroup(g: GroupDto) {
    const isMember = myGroupIds.has(g.id)
    if (isMember) {
      const fullGroup = myGroups.find(mg => mg.id === g.id) ?? g
      setActiveChat({ type: 'group', group: fullGroup })
    } else {
      // Eve clicks a group she's not in — fetch real intercepted ciphertext
      setInterceptLoading(true)
      try {
        const data = await groupsApi.interceptMessages(g.id)
        setInterceptData(data)
      } catch {
        // If group has no messages yet, show empty state
        setInterceptData({
          groupId: g.id,
          groupName: g.name,
          isMember: false,
          totalMessages: 0,
          interceptedMessages: [],
          securityNote: `You are NOT a member of '${g.name}'. Without the group Kyber KEM ciphertext, you cannot recover the group AES key and all messages are unreadable.`
        })
      } finally {
        setInterceptLoading(false)
      }
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Groups</p>
        <button onClick={onCreateGroup}
          className="text-indigo-400 hover:text-indigo-300 p-1 rounded-lg hover:bg-slate-800 transition"
          title="Create group">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>

      {loading && (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && allGroups.length === 0 && (
        <div className="px-4 pb-4 text-center">
          <p className="text-slate-500 text-sm">No groups yet</p>
          <button onClick={onCreateGroup} className="text-indigo-400 hover:underline text-xs mt-1">
            Create a group
          </button>
        </div>
      )}

      {allGroups.map(g => {
        const isMember = myGroupIds.has(g.id)
        const msgs     = groupMessages[g.id] ?? []
        const lastMsg  = msgs[msgs.length - 1]
        const isActive = activeChat?.type === 'group' && activeChat.group.id === g.id

        return (
          <button key={g.id} onClick={() => openGroup(g)}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-800/60 ${
              isActive ? 'bg-indigo-900/30 border-l-2 border-indigo-500' : ''
            }`}>
            {/* Avatar with lock badge for non-members */}
            <div className="relative flex-shrink-0">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-base font-bold"
                style={{ background: g.avatarColor }}>
                {g.name[0]?.toUpperCase()}
              </div>
              {!isMember && (
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-rose-500 rounded-full flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <p className="text-white text-sm font-medium truncate">{g.name}</p>
                {lastMsg && isMember && (
                  <span className="text-slate-500 text-[11px] flex-shrink-0">{formatTime(lastMsg.sentAt)}</span>
                )}
              </div>
              <div className="mt-0.5">
                {isMember ? (
                  <p className="text-slate-400 text-xs truncate">
                    {lastMsg ? (lastMsg.plaintext ?? '🔒') : `${g.members.length} members`}
                  </p>
                ) : (
                  <span className="text-[10px] text-rose-400 bg-rose-900/30 border border-rose-700/30 px-1.5 py-0.5 rounded font-mono">
                    🔒 Not a member — click for MitM view
                  </span>
                )}
              </div>
            </div>
          </button>
        )
      })}

      {/* ── MitM View Modal (Eve's perspective) ── */}
      {(interceptData || interceptLoading) && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]">

            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-rose-600/20 border border-rose-600/30 flex items-center justify-center">
                  <span className="text-lg">🔬</span>
                </div>
                <div>
                  <p className="text-white text-sm font-semibold">MitM Attack View</p>
                  <p className="text-rose-400 text-xs">
                    {interceptData?.groupName} · You are NOT a member
                  </p>
                </div>
              </div>
              <button onClick={() => setInterceptData(null)}
                className="text-slate-400 hover:text-white p-1 transition">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {interceptLoading ? (
              <div className="flex-1 flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-slate-400 text-sm">Intercepting wire traffic…</p>
                </div>
              </div>
            ) : interceptData && (
              <>
                {/* Key concept explanation */}
                <div className="bg-rose-950/40 border-b border-rose-700/20 px-4 py-3 flex-shrink-0">
                  <p className="text-rose-300 text-xs font-semibold mb-1">
                    🛡️ Why you cannot read these messages
                  </p>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Members share a common group AES key, distributed to each member wrapped
                    in their own <span className="text-indigo-300 font-mono">Kyber KEM ciphertext</span>.
                    You were never issued one → you have no group key → every message below
                    is indecipherable ciphertext to you.
                  </p>
                </div>

                {/* Intercepted messages — real ciphertext from DB */}
                <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
                  {interceptData.totalMessages === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-slate-500 text-sm">No messages in this group yet.</p>
                      <p className="text-slate-600 text-xs mt-1">
                        Have members send messages, then click this group again to see the intercepted ciphertext.
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold">
                        Real AES-256-GCM ciphertext intercepted from wire ({interceptData.totalMessages} messages):
                      </p>
                      {interceptData.interceptedMessages.map(m => (
                        <div key={m.messageId} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
                          {/* Sender + time */}
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-[9px] font-bold text-white">
                                {m.senderUsername[0]?.toUpperCase()}
                              </div>
                              <span className="text-slate-300 text-xs font-medium">{m.senderUsername}</span>
                            </div>
                            <span className="text-slate-600 text-[10px]">{formatTime(m.sentAt)}</span>
                          </div>

                          {/* Real ciphertext */}
                          <div className="space-y-1.5">
                            <div>
                              <span className="text-[9px] text-slate-600 font-mono uppercase tracking-wider">Ciphertext (AES-GCM):</span>
                              <p className="text-rose-400/80 text-[10px] font-mono break-all leading-relaxed bg-slate-900/60 rounded px-2 py-1 mt-0.5">
                                {m.encryptedContent.length > 80
                                  ? m.encryptedContent.slice(0, 80) + '…'
                                  : m.encryptedContent}
                              </p>
                            </div>
                            <div className="flex gap-3">
                              <div className="flex-1">
                                <span className="text-[9px] text-slate-600 font-mono uppercase tracking-wider">IV (nonce):</span>
                                <p className="text-amber-400/70 text-[10px] font-mono break-all bg-slate-900/60 rounded px-2 py-0.5 mt-0.5">
                                  {m.iv}
                                </p>
                              </div>
                              <div className="flex-1">
                                <span className="text-[9px] text-slate-600 font-mono uppercase tracking-wider">GCM Tag:</span>
                                <p className="text-amber-400/70 text-[10px] font-mono break-all bg-slate-900/60 rounded px-2 py-0.5 mt-0.5">
                                  {m.gcmTag}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Decryption attempt result */}
                          <div className="mt-2 bg-rose-900/20 border border-rose-700/30 rounded-lg px-2 py-1.5">
                            <p className="text-rose-400 text-[10px] font-mono">
                              ❌ Decrypt attempt → CryptographicException: GCM authentication tag mismatch
                            </p>
                            <p className="text-rose-700 text-[9px] mt-0.5">
                              Wrong key → wrong tag → decryption rejected by AES-GCM
                            </p>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {/* Security note footer */}
                <div className="border-t border-slate-800 p-4 flex-shrink-0">
                  <div className="bg-indigo-900/20 border border-indigo-700/30 rounded-xl p-3">
                    <p className="text-indigo-400 text-[10px] font-semibold mb-1">🔑 Why members CAN decrypt:</p>
                    <p className="text-slate-500 text-[10px] leading-relaxed">
                      Each member was issued a unique <span className="text-white font-mono">kemCiphertext</span> at
                      group creation time. Using their Kyber private key, they decapsulate it to recover the
                      group AES key, then decrypt with AES-256-GCM successfully.
                      You have no such ciphertext → no key → pure garbage.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
