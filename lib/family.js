// Family sharing (two parents, no accounts) — storage, auth and validation for api/family/*.
//
// Redis layout per family F (Upstash; an in-memory twin is used when no Redis env is set):
//   fam:F      hash  rev=<last revision>  n=<device count>  c=<created ms>  d:<deviceId>=<"s1:"+sha256(secret)>
//   fam:F:i    hash  <eventId> = "<updatedAt>|<e|t>|<json>"   (e = event, t = tombstone {id, deletedAt})
//   fam:F:l    zset  <eventId> scored by the revision of its latest write (one member per id)
//   fam:code:C string familyId, 15-min TTL, single use (GETDEL on join)
//
// Commands per sync: 1 (HMGET auth; early exit when nothing was pushed and the client is up to date)
// or 2 (HMGET + one EVAL that merges, bumps the revision and returns the changes atomically).
// Every device has its own secret, so leaving revokes only that device; only hashes are stored.
import crypto from "node:crypto";
import { redis } from "./redis.js";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export const CODE_LEN = 6;
export const CODE_TTL_SEC = 15 * 60;
export const MAX_PUSH = 500; // events + tombstones per request
export const PULL_LIMIT = 500; // items per response (client loops while `more`)
export const MAX_ITEMS = 60000; // per family
const MAX_BODY = 512 * 1024;
const TYPES = new Set(["nursing", "diaper", "custom", "sleep"]);
const MIN_TS = 946684800000; // 2000-01-01
const YEAR = 366 * 864e5;

const metaKey = (f) => `fam:${f}`;
const itemsKey = (f) => `fam:${f}:i`;
const logKey = (f) => `fam:${f}:l`;
const codeKey = (c) => `fam:code:${c}`;

/* ------------------------------------------------------------------ ids / secrets */
const b64 = (n) => crypto.randomBytes(n).toString("base64url");
export const newFamilyId = () => "f_" + b64(16); // 24 chars
export const newDeviceId = () => "d_" + b64(9); // 14 chars
export const newSecret = () => b64(32); // 43 chars
export function newCode() {
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}
/** "abc-d23" → "ABCD23"; null unless it is 6 characters of the code alphabet. */
export function normalizeCode(v) {
  if (typeof v !== "string" || v.length > 32) return null;
  const s = v.toUpperCase().replace(/[\s-]/g, "");
  return s.length === CODE_LEN && [...s].every((ch) => CODE_ALPHABET.includes(ch)) ? s : null;
}
export const hashSecret = (secret) => "s1:" + crypto.createHash("sha256").update(secret).digest("base64url");
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
/** {familyId, deviceId, secret} shape check (no storage access). */
export function credsOk(b) {
  return !!b && typeof b.familyId === "string" && /^f_[\w-]{22}$/.test(b.familyId) &&
    typeof b.deviceId === "string" && /^d_[\w-]{12}$/.test(b.deviceId) &&
    typeof b.secret === "string" && /^[\w-]{43}$/.test(b.secret);
}

/* ------------------------------------------------------------------ body reader */
/** JSON body up to 512 KB (lib/http.js readJson stops at 16 KB; a first sync can be bigger). */
export async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") {
    if (req.body.length > MAX_BODY) throw new Error("too large");
    return JSON.parse(req.body || "{}");
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new Error("too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/* ------------------------------------------------------------------ validation */
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isTs = (v, now) => isNum(v) && v >= MIN_TS && v <= now + YEAR;
const isId = (v) => typeof v === "string" && /^[\w.:-]{1,64}$/.test(v);

/** A clean copy of a client event (known fields only, note ≤ 80 chars, updatedAt clamped to the
    server clock + 1 min), or null if invalid. */
export function normEvent(e, now) {
  if (!e || typeof e !== "object" || !isId(e.id) || !TYPES.has(e.type) || !isTs(e.timestamp, now)) return null;
  const out = { id: e.id, type: e.type };
  if (e.subtype != null) {
    if (typeof e.subtype !== "string" || !/^[a-z]{1,16}$/.test(e.subtype)) return null;
    out.subtype = e.subtype;
  }
  out.timestamp = e.timestamp;
  if (e.endTimestamp != null) {
    if (!isTs(e.endTimestamp, now)) return null;
    out.endTimestamp = e.endTimestamp;
  }
  if (e.durationMs != null) {
    if (!isNum(e.durationMs) || e.durationMs < 0 || e.durationMs > 7 * 864e5) return null;
    out.durationMs = e.durationMs;
  }
  if (e.note != null) {
    if (typeof e.note !== "string") return null;
    out.note = e.note.slice(0, 80);
  }
  if (e.updatedAt != null) {
    if (!isTs(e.updatedAt, now)) return null;
    out.updatedAt = Math.min(e.updatedAt, now + 6e4);
  }
  return out;
}
export function normTomb(t, now) {
  if (!t || typeof t !== "object" || !isId(t.id) || !isTs(t.deletedAt, now)) return null;
  return { id: t.id, deletedAt: Math.min(t.deletedAt, now + 6e4) };
}

/* Stored value: "<u>|<k>|<json>". The same last-writer-wins rule as shared/rules.js mergeData:
   newer u wins; on equal u a tombstone beats an event (deletedAt >= updatedAt deletes), and
   between two events the larger serialized value wins (deterministic tie-break). */
export function toValue(kind, obj) {
  const u = kind === "t" ? obj.deletedAt : (isNum(obj.updatedAt) ? obj.updatedAt : obj.timestamp);
  return `${u}|${kind}|${JSON.stringify(obj)}`;
}
function parseValue(v) {
  const p = v.indexOf("|");
  return { u: Number(v.slice(0, p)), k: v.charAt(p + 1) };
}
export function wins(v, cur) {
  if (!cur) return true;
  const a = parseValue(v), b = parseValue(cur);
  if (a.u !== b.u) return a.u > b.u;
  if (a.k === "t") return b.k === "e";
  return b.k === "e" && v > cur;
}
/** Splits stored values into {events, tombstones}. */
export function decodeValues(values) {
  const events = [], tombstones = [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    const p = v.indexOf("|");
    const k = v.charAt(p + 1);
    try {
      const obj = JSON.parse(v.slice(p + 3));
      (k === "t" ? tombstones : events).push(obj);
    } catch { /* skip a corrupt value */ }
  }
  return { events, tombstones };
}

/* ------------------------------------------------------------------ storage */
const mem = globalThis.__familyMem || (globalThis.__familyMem = { families: new Map(), codes: new Map() });

export async function createFamily(familyId, deviceId, hash) {
  if (!redis) {
    mem.families.set(familyId, { rev: 0, devices: new Map([[deviceId, hash]]), items: new Map(), log: new Map() });
    return;
  }
  await redis.hset(metaKey(familyId), { rev: 0, n: 1, c: Date.now(), ["d:" + deviceId]: hash });
}

/** Checks a device's secret. → {rev, devices} or null (unknown family/device or wrong secret). */
export async function authDevice(familyId, deviceId, secret) {
  let rev, stored, devices;
  if (!redis) {
    const f = mem.families.get(familyId);
    if (!f) return null;
    rev = f.rev; stored = f.devices.get(deviceId); devices = f.devices.size;
  } else {
    const m = await redis.hmget(metaKey(familyId), "rev", "d:" + deviceId, "n");
    if (!m) return null;
    rev = Number(m.rev) || 0; stored = m["d:" + deviceId]; devices = Number(m.n) || 0;
  }
  if (typeof stored !== "string") return null;
  if (!safeEqual(stored, hashSecret(secret))) return null;
  return { rev, devices };
}

/** Saves an invite code → familyId (15 min). false if the code is already taken. */
export async function putCode(code, familyId) {
  if (!redis) {
    const cur = mem.codes.get(code);
    if (cur && cur.exp > Date.now()) return false;
    mem.codes.set(code, { familyId, exp: Date.now() + CODE_TTL_SEC * 1000 });
    return true;
  }
  return (await redis.set(codeKey(code), familyId, { nx: true, ex: CODE_TTL_SEC })) === "OK";
}
/** Single use: returns the familyId and deletes the code, or null. */
export async function takeCode(code) {
  if (!redis) {
    const cur = mem.codes.get(code);
    mem.codes.delete(code);
    return cur && cur.exp > Date.now() ? cur.familyId : null;
  }
  const v = await redis.getdel(codeKey(code));
  return typeof v === "string" ? v : null;
}

const JOIN_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
  return redis.call('HINCRBY', KEYS[1], 'n', 1)
end
return tonumber(redis.call('HGET', KEYS[1], 'n') or '0')`;

/** Adds a device to a family → device count, or -1 if the family no longer exists. */
export async function addDevice(familyId, deviceId, hash) {
  if (!redis) {
    const f = mem.families.get(familyId);
    if (!f) return -1;
    f.devices.set(deviceId, hash);
    return f.devices.size;
  }
  return Number(await redis.eval(JOIN_LUA, [metaKey(familyId)], ["d:" + deviceId, hash]));
}

const LEAVE_LUA = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then return 0 end
redis.call('HDEL', KEYS[1], ARGV[1])
local n = redis.call('HINCRBY', KEYS[1], 'n', -1)
if n <= 0 then redis.call('DEL', KEYS[1], KEYS[2], KEYS[3]) end
return 1`;

/** Removes a device; the family's data is deleted with its last device. */
export async function removeDevice(familyId, deviceId) {
  if (!redis) {
    const f = mem.families.get(familyId);
    if (!f) return;
    f.devices.delete(deviceId);
    if (!f.devices.size) mem.families.delete(familyId);
    return;
  }
  await redis.eval(LEAVE_LUA, [metaKey(familyId), itemsKey(familyId), logKey(familyId)], ["d:" + deviceId]);
}

/* Atomic merge + pull. ARGV: since, limit, maxItems, then (id, value) pairs.
   Returns {clientRev, more, devices, lostCount, lost..., pulled...}; {-1} = family gone, {-2} = full.
   "lost" = the server's current value for pushed items that lost the LWW compare, so the client
   always ends up with the winner even if it pulled that winner long ago.
   Pulled = items written in (since, revBeforeThisPush]; this push's own writes are not echoed. */
const SYNC_LUA = `
local meta, items, log = KEYS[1], KEYS[2], KEYS[3]
if redis.call('EXISTS', meta) == 0 then return {-1} end
local since = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local maxItems = tonumber(ARGV[3])
local n = #ARGV
local function parse(v)
  local p = string.find(v, '|', 1, true)
  return tonumber(string.sub(v, 1, p - 1)), string.sub(v, p + 1, p + 1)
end
local oldRev = tonumber(redis.call('HGET', meta, 'rev') or '0') or 0
if n > 3 and redis.call('HLEN', items) + (n - 3) / 2 > maxItems then return {-2} end
local rev = oldRev
local lost = {}
for i = 4, n - 1, 2 do
  local id, v = ARGV[i], ARGV[i + 1]
  local cur = redis.call('HGET', items, id)
  local win = true
  if cur then
    local u, k = parse(v)
    local cu, ck = parse(cur)
    if u ~= cu then win = u > cu
    elseif k == 't' then win = (ck == 'e')
    else win = (ck == 'e' and v > cur) end
  end
  if win then
    rev = rev + 1
    redis.call('HSET', items, id, v)
    redis.call('ZADD', log, rev, id)
  else
    lost[#lost + 1] = cur
  end
end
if rev ~= oldRev then redis.call('HSET', meta, 'rev', rev) end
if since > oldRev then since = 0 end
local out = {rev, 0, tonumber(redis.call('HGET', meta, 'n') or '0') or 0, #lost}
for _, v in ipairs(lost) do out[#out + 1] = v end
if since < oldRev then
  local r = redis.call('ZRANGEBYSCORE', log, '(' .. since, oldRev, 'WITHSCORES', 'LIMIT', 0, limit + 1)
  local count = #r / 2
  local take = count
  if count > limit then
    take = limit
    out[1] = tonumber(r[limit * 2])
    out[2] = 1
  end
  for j = 1, take do
    local v = redis.call('HGET', items, r[j * 2 - 1])
    if v then out[#out + 1] = v end
  end
end
return out`;

/** In-memory twin of SYNC_LUA (same algorithm, local dev only). */
function memSync(familyId, since, pairs, limit) {
  const f = mem.families.get(familyId);
  if (!f) return [-1];
  if (pairs.length && f.items.size + pairs.length > MAX_ITEMS) return [-2];
  const oldRev = f.rev;
  let rev = oldRev;
  const lost = [];
  for (const [id, v] of pairs) {
    const cur = f.items.get(id);
    if (wins(v, cur)) { rev++; f.items.set(id, v); f.log.set(id, rev); } else lost.push(cur);
  }
  f.rev = rev;
  if (since > oldRev) since = 0;
  const out = [rev, 0, f.devices.size, lost.length, ...lost];
  if (since < oldRev) {
    const r = [...f.log].filter(([, s]) => s > since && s <= oldRev).sort((a, b) => a[1] - b[1]);
    let take = r;
    if (r.length > limit) { take = r.slice(0, limit); out[0] = take[limit - 1][1]; out[1] = 1; }
    for (const [id] of take) out.push(f.items.get(id));
  }
  return out;
}

/** Merges pushed values (Map id → value) and returns changes since `since`.
    → {rev, more, devices, events, tombstones} | {gone:true} | {full:true} */
export async function syncFamily(familyId, since, pushed) {
  const pairs = [...pushed];
  let r;
  if (!redis) r = memSync(familyId, since, pairs, PULL_LIMIT);
  else {
    r = await redis.eval(SYNC_LUA, [metaKey(familyId), itemsKey(familyId), logKey(familyId)],
      [String(since), String(PULL_LIMIT), String(MAX_ITEMS), ...pairs.flat()]);
  }
  if (!Array.isArray(r) || r[0] === -1) return { gone: true };
  if (r[0] === -2) return { full: true };
  const [rev, more, devices, lostCount] = r.map((x, i) => (i < 4 ? Number(x) : x));
  const values = r.slice(4).filter((v) => typeof v === "string");
  void lostCount; // lost values and pulled values are decoded the same way
  return { rev, more: more === 1, devices, ...decodeValues(values) };
}
