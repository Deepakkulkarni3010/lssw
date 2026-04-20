// ─── Search Types ─────────────────────────────────────────────────────────────

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

export interface SearchResult {
  total: number;
  page: number;
  perPage: number;
  results: CandidateCard[];
  cached: boolean;
  executedAt: string;
  durationMs?: number;
}

// ─── Job Types ────────────────────────────────────────────────────────────────

export type JobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rate_limited'
  | 'captcha';

export interface SearchJob {
  jobId: string;
  userId: string;
  params: SearchParams;
  status: JobStatus;
  resultKey?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

// ─── User Types ───────────────────────────────────────────────────────────────

export type LinkedInTier = 'basic' | 'premium' | 'recruiter';

export interface User {
  id: string;
  linkedinId: string;
  email?: string;
  fullName: string;
  headline?: string;
  profilePic?: string;
  linkedinTier: LinkedInTier;
  createdAt: Date;
  lastLoginAt: Date;
  isActive: boolean;
  gdprConsentAt?: Date;
  gdprConsentVersion?: string;
}

export interface UserSession {
  userId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken?: string;
  tokenExpiresAt: number;
  linkedinId: string;
  gdprConsented: boolean;
}

// ─── Saved Search Types ───────────────────────────────────────────────────────

export interface SavedSearch {
  id: string;
  userId: string;
  name: string;
  description?: string;
  searchParams: SearchParams;
  isTemplate: boolean;
  createdAt: Date;
  updatedAt: Date;
  runCount: number;
  lastRunAt?: Date;
}

// ─── History Types ────────────────────────────────────────────────────────────

export type SearchStatus = 'pending' | 'running' | 'completed' | 'failed' | 'rate_limited' | 'captcha';

export interface SearchHistoryEntry {
  id: string;
  userId: string;
  searchParams: SearchParams;
  resultCount?: number;
  executedAt: Date;
  durationMs?: number;
  status: SearchStatus;
  errorMessage?: string;
  savedSearchId?: string;
}

// ─── API Response Types ───────────────────────────────────────────────────────

export interface ApiError {
  error: {
    code: string;
    message: string;
    retryAfter?: number;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
}

// ─── GDPR Types ───────────────────────────────────────────────────────────────

export interface GdprAuditLog {
  id: string;
  userId: string;
  action: 'read' | 'write' | 'delete' | 'export';
  resource: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}

export interface GdprDataExport {
  exportedAt: string;
  region: string;
  user: Partial<User>;
  searchHistory: SearchHistoryEntry[];
  savedSearches: SavedSearch[];
}

// ─── Express Session Augmentation ─────────────────────────────────────────────

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    encryptedAccessToken?: string;
    encryptedRefreshToken?: string;
    tokenExpiresAt?: number;
    linkedinId?: string;
    gdprConsented?: boolean;
    oauthState?: string;
    codeVerifier?: string;
  }
}
