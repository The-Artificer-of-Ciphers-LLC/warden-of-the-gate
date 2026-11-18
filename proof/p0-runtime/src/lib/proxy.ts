// Recording, REFUSING egress proxy. Every CONNECT / absolute-URI request is logged and answered 403;
// nothing is ever forwarded upstream. Used to observe (not permit) any attempted hosted-model request.
import http from 'node:http';
import net from 'node:net';

export interface EgressAttempt { at: string; method: string; target: string; host: string }
export interface RefusingProxy { port: number; attempts: EgressAttempt[]; close: () => Promise<void> }

export function startRefusingProxy(): Promise<RefusingProxy> {
  const attempts: EgressAttempt[] = [];
  const log = (method: string, target: string) => {
    let host = target;
    try { host = target.includes('://') ? new URL(target).hostname : target.split(':')[0]; } catch { /* keep raw */ }
    attempts.push({ at: new Date().toISOString(), method, target, host });
  };
  const server = http.createServer((req, res) => {
    log(req.method ?? '?', req.url ?? '?');
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('warden-proof: egress refused');
  });
  server.on('connection', (s: net.Socket) => s.on('error', () => { /* client resets are expected */ }));
  server.on('clientError', (_e, s) => { try { s.destroy(); } catch { /* ignore */ } });
  server.on('connect', (req, socket: net.Socket) => {
    log('CONNECT', req.url ?? '?');
    socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as net.AddressInfo).port, attempts, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }) });
    });
  });
}

export const proxyEnv = (port: number): Record<string, string> => ({
  HTTP_PROXY: `http://127.0.0.1:${port}`, HTTPS_PROXY: `http://127.0.0.1:${port}`, ALL_PROXY: `http://127.0.0.1:${port}`,
  http_proxy: `http://127.0.0.1:${port}`, https_proxy: `http://127.0.0.1:${port}`, all_proxy: `http://127.0.0.1:${port}`,
  NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
});
