import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  pgEnum,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const linkedinTierEnum = pgEnum('linkedin_tier', ['basic', 'premium', 'recruiter']);
export const searchStatusEnum = pgEnum('search_status', [
  'pending', 'running', 'completed', 'failed', 'rate_limited', 'captcha',
]);
export const gdprActionEnum = pgEnum('gdpr_action', ['read', 'write', 'delete', 'export']);

// ─── Tables ───────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  linkedinId:           varchar('linkedin_id', { length: 64 }).notNull().unique(),
  email:                varchar('email', { length: 255 }),
  fullName:             varchar('full_name', { length: 255 }).notNull(),
  headline:             varchar('headline', { length: 512 }),
  profilePic:           text('profile_pic'),
  linkedinTier:         linkedinTierEnum('linkedin_tier').notNull().default('premium'),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt:          timestamp('last_login_at', { withTimezone: true }).notNull().defaultNow(),
  isActive:             boolean('is_active').notNull().default(true),
  // GDPR fields
  gdprConsentAt:        timestamp('gdpr_consent_at', { withTimezone: true }),
  gdprConsentVersion:   varchar('gdpr_consent_version', { length: 20 }),
  gdprConsentIp:        varchar('gdpr_consent_ip', { length: 45 }),
  dataRetentionUntil:   timestamp('data_retention_until', { withTimezone: true }),
  deletionRequestedAt:  timestamp('deletion_requested_at', { withTimezone: true }),
}, (table) => ({
  linkedinIdIdx: index('idx_users_linkedin_id').on(table.linkedinId),
}));

export const savedSearches = pgTable('saved_searches', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:         varchar('name', { length: 255 }).notNull(),
  description:  text('description'),
  searchParams: jsonb('search_params').notNull().default({}),
  isTemplate:   boolean('is_template').notNull().default(false),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  runCount:     integer('run_count').notNull().default(0),
  lastRunAt:    timestamp('last_run_at', { withTimezone: true }),
}, (table) => ({
  userIdIdx: index('idx_saved_searches_user_id').on(table.userId),
}));

export const searchHistory = pgTable('search_history', {
  id:             uuid('id').primaryKey().defaultRandom(),
  userId:         uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  searchParams:   jsonb('search_params').notNull().default({}),
  resultCount:    integer('result_count'),
  executedAt:     timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
  durationMs:     integer('duration_ms'),
  status:         searchStatusEnum('status').notNull().default('pending'),
  errorMessage:   text('error_message'),
  savedSearchId:  uuid('saved_search_id').references(() => savedSearches.id, { onDelete: 'set null' }),
  // GDPR: auto-purge marker
  purgeDueAt:     timestamp('purge_due_at', { withTimezone: true }),
}, (table) => ({
  userIdIdx:     index('idx_search_history_user_id').on(table.userId),
  executedAtIdx: index('idx_search_history_executed_at').on(table.executedAt),
}));

export const rateLimitLog = pgTable('rate_limit_log', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  searchCount: integer('search_count').notNull().default(1),
}, (table) => ({
  uniqueUserWindow: unique('uq_rate_limit_user_window').on(table.userId, table.windowStart),
}));

// GDPR audit log — never deleted, retained for 365 days
export const gdprAuditLog = pgTable('gdpr_audit_log', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull(),  // intentionally no FK — must survive user deletion
  action:     gdprActionEnum('action').notNull(),
  resource:   varchar('resource', { length: 255 }).notNull(),
  ipAddress:  varchar('ip_address', { length: 45 }).notNull(),
  userAgent:  text('user_agent'),
  details:    jsonb('details').default({}),
  timestamp:  timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx:   index('idx_gdpr_audit_user_id').on(table.userId),
  timestampIdx: index('idx_gdpr_audit_timestamp').on(table.timestamp),
}));

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  savedSearches: many(savedSearches),
  searchHistory: many(searchHistory),
}));

export const savedSearchesRelations = relations(savedSearches, ({ one, many }) => ({
  user: one(users, { fields: [savedSearches.userId], references: [users.id] }),
  historyEntries: many(searchHistory),
}));

export const searchHistoryRelations = relations(searchHistory, ({ one }) => ({
  user: one(users, { fields: [searchHistory.userId], references: [users.id] }),
  savedSearch: one(savedSearches, {
    fields: [searchHistory.savedSearchId],
    references: [savedSearches.id],
  }),
}));
