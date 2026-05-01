import { useState } from 'react'
import { useAuthStore } from '../../store/authStore'
import { useChatStore } from '../../store/chatStore'
import { authApi } from '../../services/api'
import FriendsList from './FriendsList'
import GroupsList from './GroupsList'
import PeopleSearch from './PeopleSearch'
import CreateGroup from '../groups/CreateGroup'

type Tab = 'chats' | 'groups' | 'people'

export default function Sidebar({ onLogout }: { onLogout: () => void }) {
  const { user } = useAuthStore()
  const { requests } = useChatStore()
  const [tab, setTab] = useState<Tab>('chats')
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)

  const pendingCount = requests.filter(r => r.receiver.id === user?.userId).length

  async function handleDeleteAccount() {
    if (!confirm('Delete your account permanently? This removes your messages, keys, friendships, and created groups.')) return
    setDeletingAccount(true)
    try {
      await authApi.deleteAccount()
      useChatStore.getState().reset()
      onLogout()
    } catch (e) {
      console.error('Delete account failed:', e)
      alert('Could not delete account. Please try again.')
    } finally {
      setDeletingAccount(false)
    }
  }

  return (
    <aside className="w-80 flex flex-col border-r border-slate-800 bg-slate-950/80 backdrop-blur">
      {/* Header */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold"
              style={{ background: user?.avatarColor }}
            >
              {user?.displayName?.[0]?.toUpperCase()}
            </div>
            <div>
              <p className="text-white text-sm font-semibold leading-tight">{user?.displayName}</p>
              <p className="text-slate-500 text-xs">@{user?.username}</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="text-slate-500 hover:text-slate-300 p-1.5 rounded-lg hover:bg-slate-800 transition"
            title="Logout"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 p-1 rounded-xl">
          {(['chats', 'groups', 'people'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors relative ${
                tab === t ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t}
              {t === 'people' && pendingCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-[10px] rounded-full flex items-center justify-center">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {tab === 'chats'  && <FriendsList />}
        {tab === 'groups' && (
          <GroupsList onCreateGroup={() => setShowCreateGroup(true)} />
        )}
        {tab === 'people' && <PeopleSearch />}
      </div>

      {/* Quantum indicator */}
      <div className="p-3 border-t border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2 text-xs text-slate-500">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse flex-shrink-0" />
            <span className="font-mono truncate">ML-KEM-768 + ECDH P-256 + AES-256-GCM</span>
          </div>
          <button
            onClick={handleDeleteAccount}
            disabled={deletingAccount}
            className="text-[11px] text-slate-500 hover:text-rose-300 disabled:opacity-40 transition flex-shrink-0"
          >
            {deletingAccount ? 'Deleting...' : 'Delete account'}
          </button>
        </div>
      </div>

      {showCreateGroup && <CreateGroup onClose={() => setShowCreateGroup(false)} />}
    </aside>
  )
}
