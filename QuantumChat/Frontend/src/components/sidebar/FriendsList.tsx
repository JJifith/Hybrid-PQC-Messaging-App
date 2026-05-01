import { useChatStore } from '../../store/chatStore'
import { useAuthStore } from '../../store/authStore'
import { formatTime } from '../../utils/crypto'
import type { FriendDto } from '../../types'

export default function FriendsList() {
  const { friends, activeChat, setActiveChat, messages } = useChatStore()
  const { user } = useAuthStore()

  function handleSelect(f: FriendDto) {
    setActiveChat({ type: 'direct', friend: f })
  }

  if (friends.length === 0) {
    return (
      <div className="p-6 text-center text-slate-500 text-sm">
        <svg className="w-10 h-10 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <p>No friends yet</p>
        <p className="text-xs mt-1">Search people to add friends</p>
      </div>
    )
  }

  return (
    <div className="py-1">
      {friends.map(f => {
        const dmKey = `dm_${f.friend.id}`
        const msgs = messages[dmKey] ?? []
        const lastMsg = msgs[msgs.length - 1]
        const unread = msgs.filter(m => m.senderId !== user?.userId && !m.isRead).length
        const isActive = activeChat?.type === 'direct' && activeChat.friend.friendshipId === f.friendshipId

        return (
          <button
            key={f.friendshipId}
            onClick={() => handleSelect(f)}
            className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/60 transition-colors text-left ${
              isActive ? 'bg-indigo-900/30 border-l-2 border-indigo-500' : ''
            }`}
          >
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold"
                style={{ background: f.friend.avatarColor }}
              >
                {f.friend.displayName[0]?.toUpperCase()}
              </div>
              {f.friend.isOnline && (
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 border-2 border-slate-950 rounded-full" />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-white text-sm font-medium truncate">{f.friend.displayName}</p>
                {lastMsg && (
                  <span className="text-slate-500 text-[11px] flex-shrink-0 ml-1">
                    {formatTime(lastMsg.sentAt)}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <p className="text-slate-400 text-xs truncate">
                  {lastMsg
                    ? (lastMsg.plaintext ?? (lastMsg.messageType === 'file' ? `📎 ${lastMsg.fileName}` : '🔒 encrypted'))
                    : (f.friend.isOnline ? 'Online' : `Last seen ${formatTime(f.friend.lastSeen)}`)}
                </p>
                {unread > 0 && (
                  <span className="ml-1 flex-shrink-0 w-5 h-5 bg-indigo-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                    {unread}
                  </span>
                )}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
