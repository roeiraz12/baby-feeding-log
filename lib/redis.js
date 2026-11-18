// Shared Upstash Redis client (Vercel Marketplace env vars), or null when no
// Redis env vars are set (local testing: callers fall back to in-memory maps).
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const redis = url && token ? new Redis({ url, token }) : null;
export const usingRedis = !!redis;
