import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function createDemoServer(port = Number(process.env.CARLSEN_PORT || 8787)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.png':'image/png' };
  const server = http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url,'http://localhost');
      if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const filename = path.resolve(root,`.${pathname}`);
      const allowed = ['demo','extension'].some((folder) => filename.startsWith(path.join(root,folder)+path.sep));
      if (!allowed) { res.writeHead(403); res.end(); return; }
      const body = await readFile(filename);
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end('Introuvable'); }
  });
  return new Promise((resolve) => server.listen(port,'127.0.0.1',()=>resolve(server)));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await createDemoServer();
  console.log('Démo : http://127.0.0.1:8787/demo/');
}
