// Servidor local para probar sin instalar nada: sirve /public y la función /api/transcribe.
// Uso: npm run dev  →  abre http://localhost:8888 en Chrome o Edge.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import transcribe from './netlify/functions/transcribe.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));

// La clave se busca en el .env del proyecto y en ~/.grabadora/.env (fuera de carpetas sincronizadas).
// Se relee en cada transcripción: si cambias la clave no hay que reiniciar.
const ARCHIVOS_ENV = [path.join(aqui, '.env'), path.join(os.homedir(), '.grabadora', '.env')];

async function cargarEnv() {
  for (const archivo of ARCHIVOS_ENV) {
    try {
      for (const [k, v] of Object.entries(parseEnv(await readFile(archivo, 'utf8')))) {
        if (v.trim()) process.env[k] = v.trim();
      }
    } catch {}
  }
}

const raiz = path.join(aqui, 'public');
const tipos = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const PORT = Number(process.env.PORT) || 8888;

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);

      if (url.pathname === '/api/transcribe') {
        await cargarEnv();
        const trozos = [];
        for await (const t of req) trozos.push(t);
        const headers = req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {};
        const peticion = new Request(url, {
          method: req.method,
          headers,
          body: req.method === 'POST' ? Buffer.concat(trozos) : undefined,
        });
        const r = await transcribe(peticion);
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
        return;
      }

      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const archivo = path.join(raiz, rel);
      if (!archivo.startsWith(raiz)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const data = await readFile(archivo);
      res.writeHead(200, { 'Content-Type': tipos[path.extname(archivo)] || 'application/octet-stream' });
      res.end(data);
    } catch (e) {
      const noExiste = e.code === 'ENOENT';
      res.writeHead(noExiste ? 404 : 500);
      res.end(noExiste ? 'No encontrado' : String(e));
    }
  })
  .listen(PORT, () => console.log(`Grabadora lista en http://localhost:${PORT}`));
