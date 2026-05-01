import { useEffect, useState, useCallback } from 'react'
import { usersApi, friendsApi, cryptoApi } from '../../services/api'
import { useChatStore } from '../../store/chatStore'
import { useAuthStore } from '../../store/authStore'
import { b64ToBytes, deriveFriendWrapKey } from '../../utils/crypto'
import type { UserSearchDto } from '../../types'

export default function PeopleSearch() {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<UserSearchDto[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy]         = useState<Record<number, boolean>>({})
  const { requests, setRequests, setFriends } = useChatStore()
  const { user } = useAuthStore()

  const incomingRequests = requests.filter(r => r.receiver.id === user?.userId)

  const doSearch = useCallback(async (q: string) => {
    setSearching(true)
    try {
      const data = await usersApi.search(q || undefined)
      setResults(data)
    } finally { setSearching(false) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => doSearch(query), 250)
    return () => clearTimeout(t)
  }, [query, doSearch])

  async function sendRequest(userId: number) {
    setBusy(b => ({ ...b, [userId]: true }))
    try {
      await friendsApi.sendRequest(userId)
      setResults(r => r.map(u => u.id === userId ? { ...u, relationStatus: 'request_sent' as const } : u))
    } catch (e: any) {
      alert(e.response?.data?.error ?? 'Failed to send request')
    } finally { setBusy(b => ({ ...b, [userId]: false })) }
  }

  async function respond(reqId: number, action: 'accept' | 'reject') {
    setBusy(b => ({ ...b, [reqId]: true }))
    try {
      const resp = await friendsApi.respond(reqId, action)

      // Remove the request from the list immediately
      setRequests(requests.filter(r => r.id !== reqId))

      if (action === 'accept' && resp.friendshipId && resp.kemCiphertext) {
        // Derive the shared key immediately and add friend to store
        try {
          const { sharedSecretB64 } = await cryptoApi.decapsulate(resp.kemCiphertext)
          const wrapKey       = await deriveFriendWrapKey(b64ToBytes(sharedSecretB64))
          const [, wrapped]   = resp.kemCiphertext.split('|')
          const wrappedBytes  = b64ToBytes(wrapped)
          const friendshipKey = new Uint8Array(wrapKey.length)
          for (let i = 0; i < wrapKey.length; i++)
            friendshipKey[i] = wrapKey[i] ^ wrappedBytes[i]
          useChatStore.getState().setSharedKey(String(resp.friendshipId), friendshipKey)
        } catch (e) { console.warn('Key derivation failed:', e) }

        // Refresh friends list to get the new entry
        const updated = await usersApi.getFriends()
        setFriends(updated)

        // Update search results to show 'friend' status
        setResults(r => {
          const req = requests.find(rq => rq.id === reqId)
          if (!req) return r
          return r.map(u => u.id === req.sender.id ? { ...u, relationStatus: 'friend' as const } : u)
        })
      }
    } catch (e: any) {
      alert(e.response?.data?.error ?? 'Failed')
    } finally { setBusy(b => ({ ...b, [reqId]: false })) }
  }

  function statusBadge(u: UserSearchDto) {
    switch (u.relationStatus) {
      case 'friend': return (
        <span className="text-emerald-400 text-xs font-medium flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg> Friends
        </span>
      )
      case 'request_sent': return (
        <span className="text-slate-400 text-xs bg-slate-700/60 px-2 py-0.5 rounded-full">Pending</span>
      )
      case 'request_received': {
        const req = requests.find(r => r.sender.id === u.id)
        if (!req) return null
        return (
          <div className="flex gap-1">
            <button onClick={() => respond(req.id, 'accept')} disabled={busy[req.id]}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-2.5 py-1 rounded-lg transition flex items-center gap-1">
              {busy[req.id] ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> : null}
              Accept
            </button>
            <button onClick={() => respond(req.id, 'reject')} disabled={busy[req.id]}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-2 py-1 rounded-lg transition">✕</button>
          </div>
        )
      }
      default: return (
        <button onClick={() => sendRequest(u.id)} disabled={busy[u.id]}
          className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-3 py-1 rounded-lg transition flex items-center gap-1">
          {busy[u.id]
            ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>}
          Add
        </button>
      )
    }
  }

  return (
    <div>
      {/* Incoming requests */}
      {incomingRequests.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-800">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Friend Requests ({incomingRequests.length})
          </p>
          {incomingRequests.map(req => (
            <div key={req.id} className="flex items-center gap-3 py-2">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                style={{ background: req.sender.avatarColor }}>
                {req.sender.displayName[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{req.sender.displayName}</p>
                <p className="text-slate-500 text-xs">@{req.sender.username}</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => respond(req.id, 'accept')} disabled={busy[req.id]}
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-2.5 py-1 rounded-lg transition flex items-center gap-1">
                  {busy[req.id] && <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />}
                  Accept
                </button>
                <button onClick={() => respond(req.id, 'reject')} disabled={busy[req.id]}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-2 py-1 rounded-lg transition">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search box */}
      <div className="px-4 py-3">
        <div className="relative">
          {searching
            ? <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            : <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>}
          <input
            className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
            placeholder="Search users…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Results */}
      <div>
        {results.map(u => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/40 transition-colors">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
                style={{ background: u.avatarColor }}>
                {u.displayName[0]?.toUpperCase()}
              </div>
              {u.isOnline && (
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 border-2 border-slate-950 rounded-full" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{u.displayName}</p>
              <p className="text-slate-500 text-xs">@{u.username}</p>
            </div>
            {statusBadge(u)}
          </div>
        ))}
        {!searching && results.length === 0 && query.length > 0 && (
          <p className="text-center text-slate-500 text-sm py-6">No users found for "{query}"</p>
        )}
        {!searching && results.length === 0 && query.length === 0 && (
          <p className="text-center text-slate-600 text-xs py-4">Type to search users</p>
        )}
      </div>
    </div>
  )
}
