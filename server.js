const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 8787);
const PUBLIC_FILES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/script.js": "script.js",
  "/match.js": "match.js",
  "/rooms.js": "rooms.js",
  "/room-config.js": "room-config.js",
};
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = Object.hasOwn(PUBLIC_FILES, pathname) && PUBLIC_FILES[pathname];
  if (req.method !== "GET" || !file) {
    res.writeHead(404).end("Not found");
    return;
  }

  fs.readFile(path.join(__dirname, file), (error, data) => {
    if (error) {
      res.writeHead(500).end("Unable to load file");
      return;
    }
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(file)],
      "cache-control": "no-store",
    }).end(data);
  });
}).listen(PORT, () => {
  console.log(`Life preview at http://localhost:${PORT}`);
});
