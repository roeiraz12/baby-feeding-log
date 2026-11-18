// Device storage: Upstash Redis (Vercel Marketplace) in production,
// an in-memory map when no Redis env vars are set (local testing only).
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const SET = "push:devices";
const key = (id) => `push:device:${id}`;
const mem = globalThis.__pushMem || (globalThis.__pushMem = new Map());

export const usingRedis = !!redis;

export async function getDevice(id) {
  if (!redis) return mem.get(id) || null;
  return (await redis.get(key(id))) || null;
}

export async function saveDevice(id, data) {
  if (!redis) { mem.set(id, data); return; }
  await redis.set(key(id), data);
  await redis.sadd(SET, id);
}

export async function deleteDevice(id) {
  if (!redis) { mem.delete(id); return; }
  await redis.del(key(id));
  await redis.srem(SET, id);
}

export async function listDeviceIds() {
  if (!redis) return [...mem.keys()];
  return (await redis.smembers(SET)) || [];
}
