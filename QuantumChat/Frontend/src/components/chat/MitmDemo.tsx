import { useState } from 'react'
import { cryptoApi, groupsApi } from '../../services/api'
import { useChatStore } from '../../store/chatStore'

interface Props {
  onClose: () => void
  groupId?: number   // if provided, show group MitM demo
}

export default function MitmDemo({ onClose, groupId }: Props) {
  const [message, setMessage]     = useState('Hello, this is a secret message!')
  const [result, setResult]       = useState<any>(null)
  const [groupResult, setGroupResult] = useState<any>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  const group = useChatStore(s =>
    groupId ? s.groups.find(g => g.id === groupId) : undefined
  )

  async function runEncryptDemo(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setResult(null)
    try {
      const data = await cryptoApi.mitmDemo(message)
      setResult(data)
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Demo failed')
    } finally { setLoading(false) }
  }

  async function runGroupMitmDemo() {
    if (!groupId) return
    setLoading(true); setError(''); setGroupResult(null)
    try {
      const data = await groupsApi.mitmDemo(groupId)
      setGroupResult(data)
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Demo failed')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-thin">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
          <div>
            <h2 className="text-white font-semibold text-lg flex items-center gap-2">
              🔬 MitM Attack Demonstration
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">
              {groupId ? `Group: ${group?.name ?? '...'} · ` : ''}Hybrid PQC — what an attacker intercepts vs what you decrypt
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Hybrid flow diagram */}
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Hybrid PQC Key Exchange</p>
            <div className="flex items-center gap-2 text-xs flex-wrap gap-y-2">
              {[
                { label: 'ML-KEM-768',  color: 'bg-violet-600' },
                { sep: '+' },
                { label: 'ECDH P-256', color: 'bg-blue-600' },
                { sep: '→' },
                { label: 'HKDF-SHA256', color: 'bg-amber-600' },
                { sep: '→' },
                { label: 'AES-256-GCM', color: 'bg-emerald-600' },
              ].map((item, i) =>
                'sep' in item
                  ? <span key={i} className="text-slate-500 font-bold text-base">{item.sep}</span>
                  : <span key={i} className={`${item.color} text-white px-2.5 py-1 rounded-lg text-xs font-semibold`}>{item.label}</span>
              )}
            </div>
            <p className="text-slate-600 text-xs mt-2">
              Combined secret = HKDF(kyberSecret ‖ ecdhSecret) — attacker must break BOTH algorithms
            </p>
          </div>

          {/* ── GROUP MitM section (only when in a group chat) ── */}
          {groupId && (
            <div className="border border-slate-700 rounded-xl overflow-hidden">
              <div className="bg-slate-800/60 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-white font-semibold text-sm">Group Access Demo</p>
                  <p className="text-slate-400 text-xs mt-0.5">
                    Eve (non-member) vs authorized members of <span className="text-indigo-400">{group?.name}</span>
                  </p>
                </div>
                <button onClick={runGroupMitmDemo} disabled={loading}
                  className="bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition flex items-center gap-1.5">
                  {loading && !result
                    ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                    : <span>▶</span>}
                  Run Group Demo
                </button>
              </div>

              {groupResult && (
                <div className="p-4 space-y-3">
                  {/* Member vs Non-member side by side */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Authorized member view */}
                    <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-base">✅</span>
                        <p className="text-emerald-400 font-semibold text-sm">Alice / Bob</p>
                        <span className="text-emerald-700 text-[10px] bg-emerald-900/40 px-1.5 py-0.5 rounded">member</span>
                      </div>
                      {groupResult.authorized ? (
                        <>
                          <p className="text-emerald-300 text-xs font-mono mb-2">
                            {groupResult.message}
                          </p>
                          <div className="bg-slate-900/50 rounded-lg p-2">
                            <p className="text-[10px] text-slate-500 mb-1">KEM ciphertext (first 60 chars):</p>
                            <p className="text-emerald-400 text-[10px] font-mono break-all">{groupResult.kemPreview}</p>
                          </div>
                          <div className="mt-2 space-y-1">
                            <p className="text-[10px] text-emerald-600">① Hybrid decapsulate KEM → combined secret</p>
                            <p className="text-[10px] text-emerald-600">② HKDF → group wrap key</p>
                            <p className="text-[10px] text-emerald-600">③ XOR wrapped bytes → group AES key</p>
                            <p className="text-[10px] text-emerald-600">④ AES-256-GCM decrypt → ✅ plaintext</p>
                          </div>
                        </>
                      ) : (
                        <p className="text-emerald-300 text-xs">You are a member — can decrypt all messages</p>
                      )}
                    </div>

                    {/* Eve (non-member) view */}
                    <div className="bg-rose-900/20 border border-rose-700/40 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-base">🚫</span>
                        <p className="text-rose-400 font-semibold text-sm">Eve</p>
                        <span className="text-rose-700 text-[10px] bg-rose-900/40 px-1.5 py-0.5 rounded">non-member</span>
                      </div>
                      {!groupResult.authorized ? (
                        <>
                          <div className="bg-slate-900/50 rounded-lg p-2 mb-2">
                            <p className="text-[10px] text-slate-500 mb-1">Intercepted ciphertext:</p>
                            <p className="text-rose-300 text-[10px] font-mono break-all leading-relaxed">
                              {groupResult.attackerSees?.interceptedCiphertext?.slice(0, 60)}…
                            </p>
                          </div>
                          <div className="bg-slate-900/50 rounded-lg p-2">
                            <p className="text-[10px] text-slate-500 mb-1">Attempted decrypt:</p>
                            <p className="text-rose-400 text-[10px] font-mono">{groupResult.attackerSees?.attemptedDecrypt}</p>
                          </div>
                          <p className="text-[10px] text-rose-700 mt-2">{groupResult.attackerSees?.status}</p>
                        </>
                      ) : (
                        <>
                          <div className="bg-slate-900/50 rounded-lg p-2 mb-2">
                            <p className="text-[10px] text-slate-500 mb-1">No KEM ciphertext:</p>
                            <p className="text-rose-300 text-[10px] font-mono">Eve was never given a wrapped group key</p>
                          </div>
                          <div className="bg-slate-900/50 rounded-lg p-2">
                            <p className="text-rose-400 text-[10px] font-mono">[CryptographicException: GCM tag mismatch]</p>
                          </div>
                          <p className="text-[10px] text-rose-700 mt-2">Must break ML-KEM-768 + ECDH P-256 to get group key</p>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Group key explanation */}
                  <div className="bg-indigo-900/20 border border-indigo-700/30 rounded-xl p-3">
                    <p className="text-xs font-semibold text-indigo-400 mb-1.5">🔑 How group key distribution works</p>
                    <div className="space-y-1 text-[11px] text-slate-400">
                      <p>• When the group is created, a random 32-byte <span className="text-white font-mono">groupMasterSecret</span> is generated</p>
                      <p>• For each member: <span className="text-white font-mono">HybridEncapsulate(memberPub)</span> → <span className="text-white font-mono">combinedSecret</span></p>
                      <p>• <span className="text-white font-mono">wrapKey = HKDF(combinedSecret, "GroupKeyWrap")</span></p>
                      <p>• Stored: <span className="text-white font-mono">kemCt:ecdhEphPub | base64(groupMasterSecret XOR wrapKey)</span></p>
                      <p>• Eve has <span className="text-rose-400 font-mono">no KEM ciphertext</span> → cannot derive <span className="text-rose-400 font-mono">wrapKey</span> → sees only random noise</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Encryption pipeline demo ── */}
          <div className="border border-slate-700 rounded-xl overflow-hidden">
            <div className="bg-slate-800/60 px-4 py-3">
              <p className="text-white font-semibold text-sm">Encryption Pipeline Demo</p>
              <p className="text-slate-400 text-xs">Step-by-step — encrypt a message and see what an attacker intercepts</p>
            </div>
            <div className="p-4 space-y-3">
              <form onSubmit={runEncryptDemo} className="flex gap-2">
                <input
                  className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  value={message} onChange={e => setMessage(e.target.value)}
                  placeholder="Enter plaintext…"
                />
                <button type="submit" disabled={loading || !message.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-medium px-3 py-2 rounded-xl transition flex items-center gap-1.5 whitespace-nowrap">
                  {loading && !groupResult
                    ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                    : '▶ Encrypt'}
                </button>
              </form>

              {error && <p className="text-red-400 text-xs bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">{error}</p>}

              {result && (
                <div className="space-y-2">
                  {[
                    { step: '1', label: 'ML-KEM-768',                        value: result.kyberAlgo,          mono: false, color: 'violet' },
                    { step: '2', label: 'ECDH P-256',                         value: result.ecdhAlgo,           mono: false, color: 'blue'   },
                    { step: '3', label: 'HKDF combination',                   value: result.hybridCombine,      mono: false, color: 'amber'  },
                    { step: '4', label: 'ML-KEM-768 KEM ciphertext',          value: result.kyberCtPreview,     mono: true,  color: 'violet' },
                    { step: '5', label: 'ECDH ephemeral public key',          value: result.ecdhEphPubPreview,  mono: true,  color: 'blue'   },
                    { step: '6', label: 'AES-256-GCM ciphertext',             value: result.aesCiphertext,      mono: true,  color: 'rose'   },
                    { step: '7', label: 'GCM IV',                             value: result.gcmIV,              mono: true,  color: 'rose'   },
                    { step: '8', label: 'GCM auth tag',                       value: result.gcmTag,             mono: true,  color: 'rose'   },
                  ].map(s => (
                    <div key={s.step} className="bg-slate-800/60 rounded-lg p-2.5 flex gap-2">
                      <span className={`text-[10px] font-bold font-mono text-${s.color}-400 bg-${s.color}-900/30 px-1.5 py-0.5 rounded h-fit flex-shrink-0`}>
                        {s.step}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[10px] text-slate-500 mb-0.5">{s.label}</p>
                        <p className={`text-xs text-slate-200 break-all ${s.mono ? 'font-mono' : ''}`}>{s.value ?? '—'}</p>
                      </div>
                    </div>
                  ))}

                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-xl p-3">
                      <p className="text-emerald-400 font-semibold text-xs mb-1">✅ Authorized</p>
                      <p className="text-emerald-300 text-xs font-mono">{result.authorizedDecrypt}</p>
                    </div>
                    <div className="bg-rose-900/20 border border-rose-700/40 rounded-xl p-3">
                      <p className="text-rose-400 font-semibold text-xs mb-1">🚫 Attacker</p>
                      <p className="text-rose-300 text-[10px] font-mono break-all">{result.attackerView?.slice(0, 80)}…</p>
                    </div>
                  </div>

                  <div className="bg-slate-800/40 rounded-lg p-3">
                    <p className="text-slate-400 text-[11px] leading-relaxed">{result.securityNote}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
