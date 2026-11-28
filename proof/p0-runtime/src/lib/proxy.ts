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

// Recording loopback TAP: a pass-through between the harness and the local model server (both on 127.0.0.1). It forwards every
// request unchanged and records, per request, when the harness hung up. When the harness closes its side mid-stream, the tap
// destroys the upstream request too, so the model server sees exactly the disconnect it would see without the tap.
// This is how the proof observes cancellation on any OpenAI-compatible server (mlx-serve documents no in-flight status).
export interface TapRequest {
  method: string; path: string; startedAt: number; firstByteAt?: number; bytesDown: number;
  /** harness closed its side before the response finished */ clientClosedAt?: number;
  /** response finished normally */ completedAt?: number; status?: number;
}
export interface ModelTap { port: number; baseURL: string; requests: TapRequest[]; close: () => Promise<void> }

export function startModelTap(upstreamPort: number): Promise<ModelTap> {
  const requests: TapRequest[] = [];
  const server = http.createServer((req, res) => {
    const rec: TapRequest = { method: req.method ?? '?', path: req.url ?? '?', startedAt: Date.now(), bytesDown: 0 };
    requests.push(rec);
    const up = http.request({ host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` } }, (ur) => {
      rec.status = ur.statusCode;
      res.writeHead(ur.statusCode ?? 502, ur.headers);
      ur.on('data', (d: Buffer) => { rec.firstByteAt ??= Date.now(); rec.bytesDown += d.length; res.write(d); });
      ur.on('end', () => { rec.completedAt = Date.now(); res.end(); });
      ur.on('error', () => { try { res.destroy(); } catch { /* gone */ } });
    });
    up.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } else res.destroy(); });
    req.pipe(up);
    res.on('close', () => {
      if (rec.completedAt === undefined) { rec.clientClosedAt = Date.now(); up.destroy(); }
    });
  });
  server.on('clientError', (_e, s) => { try { s.destroy(); } catch { /* ignore */ } });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, baseURL: `http://127.0.0.1:${port}/v1`, requests, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }) });
    });
  });
}

/** The chat/completions streams the tap saw start in [from, to). */
export const inferenceRequests = (t: ModelTap, from = 0, to = Infinity) =>
  t.requests.filter((x) => /\/chat\/completions|\/responses|\/completions/.test(x.path) && x.startedAt >= from && x.startedAt < to);
