/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare Worker Environment Definition
 * All secrets and bindings are defined here.
 */
export interface Env {
  // D1 Database (main storage)
  DB: D1Database;

  // KV Namespace (caching)
  CACHE: KVNamespace;

  // Durable Object (price stream)
  PRICE_STREAM: DurableObjectNamespace;

  // Environment variables
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;

  // ── Secrets (Grok-only now) ─────────────────────────────────────
  GROK_API_KEY: string;           // xAI Grok API key (required)

  // Optional third-party data providers
  POLYGON_API_KEY?: string;
  FINNHUB_KEY?: string;
  FRED_API_KEY?: string;

  // Payments
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;

  // Email notifications
  RESEND_API_KEY?: string;

  // Security
  SESSION_PEPPER: string;         // Used for password hashing
  ADMIN_BOOTSTRAP_TOKEN?: string; // One-time bootstrap token
}

// ── Shared Types used across the entire project ─────────────────────
export type Role = 'admin' | 'analyst' | 'subscriber';
export type Tier = 'core' | 'pro' | 'institutional' | 'none';
export type SubStatus = 'pending' | 'active' | 'past_due' | 'cancelled' | 'inactive';
export type Sentiment = 'Strongly Bullish' | 'Bullish' | 'Neutral' | 'Cautious' | 'Bearish';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  password_salt: string;
  password_iters: number;
  role: Role;
  tier: Tier;
  subscription_status: SubStatus;
  stripe_customer_id: string | null;
  email_verified_at: string | null;
  created_at: string;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  tier: Tier;
  subscription_status: SubStatus;
}

export interface Quote {
  price: number;
  prev: number;
  change: number;
  pct: number;
  hi: number;
  lo: number;
  open?: number;
  volume?: number;
  ts: number;
  source: 'polygon' | 'finnhub' | 'cache';
  delayed: boolean;
}

export interface NewsItem {
  headline: string;
  source: string;
  url: string;
  ts: number;
  sentiment: 'positive' | 'negative' | 'neutral';
}

export interface AnalystRecs {
  buy: number;
  hold: number;
  sell: number;
  strongBuy: number;
  strongSell: number;
  total: number;
}

export interface AnalysisResult {
  ticker: string;
  sector: string;
  strength: number;
  sentiment: Sentiment;
  summary: string;
  bulls: string[];
  bears: string[];
  insight: string;
  description: string;
  model: string;
  inputHash: string;
  createdAt: string;
}
