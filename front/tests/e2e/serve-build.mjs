import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const buildDirectory = new URL('../../dist/validador-msc/browser/', import.meta.url);
const contentTypes = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript' };

createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  const asset = path === '/' ? 'index.html' : path.slice(1);
  const extension = /^[A-Za-z0-9_-]+\.(html|css|js)$/.exec(asset)?.[1];
  if (!extension || (request.method !== 'GET' && request.method !== 'HEAD')) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(new URL(asset, buildDirectory));
    response.writeHead(200, { 'Content-Type': contentTypes[extension] }).end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(4217, '127.0.0.1');
