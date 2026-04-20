import { create } from 'zustand';

export interface SearchParams {
  keywords?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  location?: string;
  industry?: string;
  school?: string;
  connectionDegree?: Array<'F' | 'S' | 'O'>;
  yearsOfExperience?: string;
  companySize?: string;
  customString?: string;
  templateId?: string;
  page?: number;
}

export interface CandidateCard {
  name: string;
  firstName?: string;
  lastName?: string;
  title: string;
  company: string;
  location: string;
  headline: string;
  profileUrl: string;
  profilePicUrl: string;
  connectionDegree: '1st' | '2nd' | '3rd' | 'Out of Network';
  isOpenToWork: boolean;
  badges: string[];
  mutualConnections?: number;
}

export interface SearchResults {
  total: number;
  page: number;
  perPage: number;
  results: CandidateCard[];
  cached: boolean;
  executedAt: string;
  hasMore: boolean;
  durationMs?: number;
}

type SearchStatus = 'idle' | 'submitting' | 'polling' | 'completed' | 'error';

interface SearchState {
  params: SearchParams;
  status: SearchStatus;
  jobId: string | null;
  results: SearchResults | null;
  error: string | null;
  rateLimit: { used: number; limit: number; remaining: number; resetAt: number } | null;

  setParams: (params: Partial<SearchParams>) => void;
  setStatus: (status: SearchStatus) => void;
  setJobId: (jobId: string | null) => void;
  setResults: (results: SearchResults | null) => void;
  setError: (error: string | null) => void;
  setRateLimit: (rl: SearchState['rateLimit']) => void;
  reset: () => void;
}

const defaultParams: SearchParams = {
  connectionDegree: ['F', 'S'],
};

export const useSearchStore = create<SearchState>((set) => ({
  params: defaultParams,
  status: 'idle',
  jobId: null,
  results: null,
  error: null,
  rateLimit: null,

  setParams: (newParams) =>
    set((state) => ({ params: { ...state.params, ...newParams } })),
  setStatus: (status) => set({ status }),
  setJobId: (jobId) => set({ jobId }),
  setResults: (results) => set({ results }),
  setError: (error) => set({ error }),
  setRateLimit: (rateLimit) => set({ rateLimit }),
  reset: () => set({ params: defaultParams, status: 'idle', jobId: null, results: null, error: null }),
}));
