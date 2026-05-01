import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CurrentUser } from '../types';

interface AuthState {
  user: CurrentUser | null;
  setUser: (u: CurrentUser | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setUser: (u) => set({ user: u }),
      logout: () => { localStorage.removeItem('qc_token'); set({ user: null }); },
    }),
    {
      name: 'qc-auth',
      // Strip private keys from localStorage — only keep public session info
      partialize: (s) => ({
        user: s.user ? { ...s.user, kyberPrivateKey: '', ecdhPrivateKey: '' } : null,
      }),
    }
  )
);
