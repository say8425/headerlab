import { connect, type Socket } from 'node:net';

/**
 * A Marionette client in `node:net` alone.
 *
 * Marionette is Firefox's own automation protocol (the one geckodriver
 * speaks): TCP, `<byte length>:<json>` frames, a hello object from the server
 * first, then commands `[0, id, name, params]` answered by
 * `[1, id, error | null, result]`. It is used here because Playwright cannot
 * load a Firefox extension, and because Marionette — under
 * `-remote-allow-system-access` — will navigate a tab to
 * `moz-extension://…`, which WebDriver BiDi refuses (measured:
 * docs/research/2026-09-08-firefox-marionette-spike.md). No dependency is
 * added for it, which is this repository's rule.
 */

export interface MarionetteError {
  error: string;
  message: string;
  stacktrace?: string;
}

export interface MarionetteClient {
  /**
   * Sends one command and resolves with its `result`.
   *
   * Rejects with the server's error, or — after `timeoutMs` — with an error
   * naming the command. The spike sat silently on a script whose syntax was
   * wrong: the callback was never called, and nothing said which command was
   * waiting. A timeout with the name in it is the difference.
   */
  send<T = unknown>(name: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  close(): void;
}

/**
 * Splits a byte stream into complete frames.
 *
 * Bytes, not characters: the readout string this suite reads back carries a
 * middle dot (two bytes), and a character count would desynchronise on it.
 * Pure, and unit-tested on its own (tests/unit/marionette.test.ts).
 */
export function parseFrames(buffer: Buffer): { messages: unknown[]; rest: Buffer } {
  const messages: unknown[] = [];
  let rest = buffer;
  for (;;) {
    const colon = rest.indexOf(0x3a); // ':'
    if (colon === -1) break;
    const head = rest.subarray(0, colon).toString('ascii');
    if (!/^\d+$/.test(head)) {
      throw new Error(`malformed Marionette frame: ${rest.subarray(0, 40).toString('utf8')}`);
    }
    const length = Number.parseInt(head, 10);
    if (rest.length < colon + 1 + length) break;
    messages.push(JSON.parse(rest.subarray(colon + 1, colon + 1 + length).toString('utf8')));
    rest = rest.subarray(colon + 1 + length);
  }
  return { messages, rest };
}

interface Pending {
  name: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Connects, retrying until Firefox is listening, and waits for the hello.
 *
 * Retrying the connect is how the launcher waits for Firefox to be up without
 * parsing its log: the port refuses until Marionette binds it. 150 × 200ms is
 * thirty seconds, which is more than a cold headless start needs.
 */
export async function connectMarionette(
  port: number,
  { attempts = 150, intervalMs = 200 }: { attempts?: number; intervalMs?: number } = {},
): Promise<MarionetteClient> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    let remaining = attempts;
    const attempt = () => {
      const s = connect({ host: '127.0.0.1', port }, () => resolve(s));
      s.once('error', (error) => {
        remaining -= 1;
        if (remaining <= 0) {
          reject(new Error(`Marionette did not answer on port ${port}: ${error.message}`));
          return;
        }
        setTimeout(attempt, intervalMs);
      });
    };
    attempt();
  });

  let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let hello: unknown = null;
  const pending = new Map<number, Pending>();
  let nextId = 1;

  socket.on('data', (chunk: Buffer) => {
    const parsed = parseFrames(Buffer.concat([buffered, chunk]));
    buffered = parsed.rest;
    for (const message of parsed.messages) {
      if (hello === null && !Array.isArray(message)) {
        hello = message;
        continue;
      }
      if (!Array.isArray(message)) continue;
      const [, id, error, result] = message as [number, number, MarionetteError | null, unknown];
      const waiting = pending.get(id);
      if (!waiting) continue;
      pending.delete(id);
      clearTimeout(waiting.timer);
      if (error) waiting.reject(new Error(`${waiting.name}: ${error.error}: ${error.message}`));
      else waiting.resolve(result);
    }
  });
  socket.on('close', () => {
    for (const [id, waiting] of pending) {
      pending.delete(id);
      clearTimeout(waiting.timer);
      waiting.reject(new Error(`${waiting.name}: Marionette socket closed`));
    }
  });

  const send = <T>(name: string, params: Record<string, unknown> = {}, timeoutMs = 20_000) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${name} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { name, resolve: resolve as (v: unknown) => void, reject, timer });
      const body = JSON.stringify([0, id, name, params]);
      socket.write(`${Buffer.byteLength(body)}:${body}`);
    });

  const helloDeadline = Date.now() + 10_000;
  while (hello === null) {
    if (Date.now() > helloDeadline) throw new Error('Marionette connected but sent no hello');
    await new Promise((r) => setTimeout(r, 20));
  }

  return { send, close: () => socket.end() };
}
