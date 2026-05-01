import { useState } from 'react'
import { groupsApi, cryptoApi } from '../../services/api'
import { useChatStore } from '../../store/chatStore'
import { useAuthStore } from '../../store/authStore'
import { b64ToBytes, deriveGroupWrapKey } from '../../utils/crypto'

export default function CreateGroup({ onClose }: { onClose: () => void }) {
  const { friends, groups, setGroups, setSharedKey } = useChatStore()
  const { user } = useAuthStore()
  const [name, setName]         = useState('')
  const [description, setDesc]  = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  function toggleMember(id: number) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim())          { setError('Group name required'); return }
    if (selected.length === 0) { setError('Select at least one friend'); return }
    setLoading(true)
    try {
      const group = await groupsApi.createGroup(name.trim(), description.trim() || undefined, selected)
      setGroups([...groups, group])

      // Derive group AES key for current user from their KEM ciphertext
      const myMember = group.members.find(m => m.userId === user?.userId)
      if (myMember && myMember.kemCiphertext && !myMember.kemCiphertext.startsWith('[')) {
        const { sharedSecretB64 } = await cryptoApi.decapsulate(myMember.kemCiphertext)
        const kyberShared = b64ToBytes(sharedSecretB64)
        const wrapKey  = await deriveGroupWrapKey(kyberShared)
        const [, wrappedPart] = myMember.kemCiphertext.split('|')
        const wrapped  = b64ToBytes(wrappedPart)
        const groupSecret = new Uint8Array(wrapKey.length)
        for (let i = 0; i < wrapKey.length; i++)
          groupSecret[i] = wrapKey[i] ^ wrapped[i]
        setSharedKey(`group_${group.id}`, groupSecret)
      }
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Failed to create group')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h2 className="text-white font-semibold text-lg">Create Group</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleCreate} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Group Name</label>
            <input
              className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
              placeholder="e.g. Study Group"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Description (optional)</label>
            <input
              className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
              placeholder="What is this group about?"
              value={description}
              onChange={e => setDesc(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Add Friends <span className="text-slate-500 font-normal">(only friends can be added)</span>
            </label>
            <div className="space-y-1 max-h-52 overflow-y-auto scrollbar-thin pr-1 rounded-xl bg-slate-800/50 p-2">
              {friends.length === 0
                ? <p className="text-slate-500 text-sm p-2">Add some friends first</p>
                : friends.map(f => (
                  <label key={f.friend.id}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-700/60 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={selected.includes(f.friend.id)}
                      onChange={() => toggleMember(f.friend.id)}
                      className="w-4 h-4 accent-indigo-500 rounded"
                    />
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      style={{ background: f.friend.avatarColor }}>
                      {f.friend.displayName[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-sm truncate">{f.friend.displayName}</p>
                      <p className="text-slate-500 text-xs">@{f.friend.username}</p>
                    </div>
                  </label>
                ))}
            </div>
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-xl transition text-sm font-medium">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white py-2.5 rounded-xl transition text-sm font-medium">
              {loading ? 'Creating…' : `Create (${selected.length + 1} members)`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
