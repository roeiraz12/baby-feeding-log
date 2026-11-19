// Tiny helpers that work both on Vercel and in the local dev server.
export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 16 * 1024) throw new Error("too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/** The raw request body as a Buffer (needed to check a signature over the exact bytes).
    Reads the stream first; falls back to a body the platform already read (req.rawBody,
    or a string / Buffer req.body; a parsed object is re-serialized as a last resort). */
export async function readRaw(req, max = 64 * 1024) {
  const chunks = [];
  let size = 0;
  if (!req.readableEnded) {
    for await (const c of req) {
      size += c.length;
      if (size > max) throw new Error("too large");
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    }
  }
  if (size > 0) return Buffer.concat(chunks);
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody, "utf8");
  const b = req.body;
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === "string") return Buffer.from(b, "utf8");
  if (b && typeof b === "object") return Buffer.from(JSON.stringify(b), "utf8");
  return Buffer.alloc(0);
}
