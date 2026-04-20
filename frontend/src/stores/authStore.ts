import { create } from 'zustand';

export interface AuthUser {
  id: string;
  fullName: string;
  email?: string;
  profilePic?: string;
  headline?: string;
  linkedinTier: 'basic' | 'premium' | 'recruiter';
  gdprConsented: boolean;
  tokenExpiresAt?: number;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  setUser: (user: AuthUser | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setLoading: (isLoading) => set({ isLoading }),
  logout: () => set({ user: null }),
}));
