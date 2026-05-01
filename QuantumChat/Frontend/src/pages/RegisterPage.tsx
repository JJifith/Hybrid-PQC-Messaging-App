import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { decryptPrivateKeyWithPassword, bytesToB64 } from '../utils/crypto'

export default function RegisterPage() {
  const [username, setUsername]       = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword]       = useState('')
  const [confirm, setConfirm]         = useState('')
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(false)
  const { setUser } = useAuthStore()
  const navigate    = useNavigate()

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      const res = await authApi.register(username, password, displayName || undefined)
      localStorage.setItem('qc_token', res.token)
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
      setError(err.response?.data?.error ?? 'Registration failed')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-violet-600/10 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 mb-4">
            <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Create Account</h1>
          <p className="text-slate-400 text-sm mt-1">ML-KEM-768 + ECDH P-256 keys auto-generated</p>
        </div>
        <div className="bg-slate-900/70 backdrop-blur border border-slate-700/50 rounded-2xl p-6 shadow-xl">
          <form onSubmit={handleRegister} className="space-y-4">
            {[
              { label: 'Username', value: username, set: setUsername, ph: 'alice', req: true },
              { label: 'Display Name (optional)', value: displayName, set: setDisplayName, ph: 'Alice Smith', req: false },
            ].map(f => (
              <div key={f.label}>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">{f.label}</label>
                <input className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                  placeholder={f.ph} value={f.value} onChange={e => f.set(e.target.value)} required={f.req} />
              </div>
            ))}
            {[
              { label: 'Password', value: password, set: setPassword },
              { label: 'Confirm Password', value: confirm, set: setConfirm },
            ].map(f => (
              <div key={f.label}>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">{f.label}</label>
                <input type="password" className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                  placeholder="••••••••" value={f.value} onChange={e => f.set(e.target.value)} required />
              </div>
            ))}
            {error && <div className="text-red-400 text-sm bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition-colors">
              {loading ? 'Generating Keys & Registering…' : 'Create Account'}
            </button>
          </form>
          <p className="text-center text-slate-400 text-sm mt-4">
            Already have an account? <Link to="/login" className="text-indigo-400 hover:text-indigo-300 font-medium">Sign In</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
