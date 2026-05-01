import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { decryptPrivateKeyWithPassword, bytesToB64 } from '../utils/crypto'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const { setUser } = useAuthStore()
  const navigate    = useNavigate()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const res = await authApi.login(username, password)
      localStorage.setItem('qc_token', res.token)

      // Decrypt both private keys locally
      const kyberPrivBytes = await decryptPrivateKeyWithPassword(res.kyberPrivateKeyEncrypted, password)
      const ecdhPrivBytes  = await decryptPrivateKeyWithPassword(res.ecdhPrivateKeyEncrypted, password)

      setUser({
        token: res.token, userId: res.userId, username: res.username,
        displayName: res.displayName, avatarColor: res.avatarColor,
        kyberPublicKey: res.kyberPublicKey, ecdhPublicKey: res.ecdhPublicKey,
        kyberPrivateKey: bytesToB64(kyberPrivBytes),
        ecdhPrivateKey:  bytesToB64(ecdhPrivBytes),
      })
      navigate('/')
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Login failed')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 mb-4">
            <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">QuantumChat</h1>
          <p className="text-slate-400 text-sm mt-1">Hybrid Post-Quantum Secure Messaging</p>
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className="text-xs bg-indigo-900/50 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-700/50">ML-KEM-768</span>
            <span className="text-xs bg-violet-900/50 text-violet-300 px-2 py-0.5 rounded-full border border-violet-700/50">ECDH P-256</span>
            <span className="text-xs bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-700/50">AES-256-GCM</span>
          </div>
        </div>
        <div className="bg-slate-900/70 backdrop-blur border border-slate-700/50 rounded-2xl p-6 shadow-xl">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>
              <input className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                placeholder="your username" value={username} onChange={e => setUsername(e.target.value)} autoFocus required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
              <input type="password" className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            {error && <div className="text-red-400 text-sm bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition-colors">
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
          <p className="text-center text-slate-400 text-sm mt-4">
            No account? <Link to="/register" className="text-indigo-400 hover:text-indigo-300 font-medium">Register</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
