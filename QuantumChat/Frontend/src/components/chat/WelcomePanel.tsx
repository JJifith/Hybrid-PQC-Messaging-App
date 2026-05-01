export default function WelcomePanel() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0f] relative overflow-hidden select-none">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative text-center max-w-sm px-4">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-indigo-600/20 border border-indigo-500/30 mb-6">
          <svg className="w-10 h-10 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>

        <h2 className="text-2xl font-bold text-white mb-2">QuantumChat</h2>
        <p className="text-slate-400 text-sm leading-relaxed mb-6">
          End-to-end encrypted with post-quantum cryptography. Select a conversation to start messaging.
        </p>

        <div className="grid grid-cols-2 gap-3 text-left">
          {[
            { icon: '🔐', title: 'ML-KEM-768', desc: 'Post-quantum KEM (NIST Level 3)' },
            { icon: '🛡️', title: 'AES-256-GCM', desc: 'Authenticated encryption' },
            { icon: '⚡', title: 'SignalR', desc: 'Real-time messaging' },
            { icon: '🚫', title: 'MitM Proof', desc: 'Outsiders see garbage' },
          ].map(f => (
            <div key={f.title} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
              <div className="text-xl mb-1">{f.icon}</div>
              <p className="text-white text-xs font-semibold">{f.title}</p>
              <p className="text-slate-500 text-xs mt-0.5">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
