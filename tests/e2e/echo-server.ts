import { createServer, type IncomingHttpHeaders } from 'node:http';

export interface RecordedRequest {
  url: string;
  headers: IncomingHttpHeaders;
}

export interface EchoServer {
  origin: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

/** Binds to an ephemeral loopback port and records every request it receives. */
export async function startEchoServer(): Promise<EchoServer> {
  const requests: RecordedRequest[] = [];

  const server = createServer((req, res) => {
    requests.push({ url: req.url ?? '', headers: { ...req.headers } });
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>echo</title><body>echo</body>');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('echo server did not bind to a port');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    // `server.close()` alone waits for open sockets to end on their own; a
    // keep-alive connection the browser is still holding onto never does,
    // and this hook runs before Playwright tears down the browser context.
    // `closeAllConnections()` (Node >= 18.2) ends them immediately.
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
