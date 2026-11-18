// Local dev server: static files + the api/ functions, like Vercel.
// Reads env vars from .env.local (KEY=value lines). Usage: node dev-server.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 8110);

const envFile = path.join(root, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  try {
    if (pathname.startsWith("/api/")) {
      const file = path.join(root, pathname + ".js");
      if (!file.startsWith(path.join(root, "api")) || !fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
      const mod = await import(pathToFileURL(file).href);
      return await mod.default(req, res);
    }
    let file = path.join(root, decodeURIComponent(pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
    res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    res.statusCode = 500; res.end("error");
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
