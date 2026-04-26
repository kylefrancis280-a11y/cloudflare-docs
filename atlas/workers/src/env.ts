/// <reference types="@cloudflare/workers-types" />

export interface Env {
  // Bindings
  DB: D1Database;
  CACHE: KVNamespace;
  PRICE_STREAM: DurableObjectNamespace;

  // Vars
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;

  // Secrets
  ANTHROPIC_API_KEY: string;
  POLYGON_API_KEY?: string;
  FINNHUB_KEY?: string;
  FRED_API_KEY?: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY?: string;
  SESSION_PEPPER: string;
}

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
