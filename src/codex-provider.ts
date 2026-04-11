/**
 * Codex Provider — LLMProvider backed by codex app-server (JSON-RPC v2 over WebSocket).
 *
 * Spawns `codex app-server --listen ws://127.0.0.1:PORT` so that:
 * 1. This provider communicates via WebSocket JSON-RPC
 * 2. TUI can simultaneously connect via `codex resume --remote ws://127.0.0.1:PORT`
 *
 * Environment variables:
 *   CTI_CODEX_WS_PORT       — WebSocket port (default: 9100)
 *   CTI_CODEX_PASS_MODEL    — Forward bridge model to Codex (default: false)
 *   CTI_CODEX_SKIP_GIT_REPO_CHECK — Allow non-git dirs (default: false)
 *   CTI_CODEX_API_KEY       — API key override
 *   CTI_CODEX_BASE_URL      — API base URL override
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, type ChildProcess } from 'node:child_process';

import type { LLMProvider, StreamChatParams } from 'claude-to-im/src/lib/bridge/host.js';
import type { PendingPermissions } from './permission-gateway.js';
import { sseEvent } from './sse-utils.js';

// ── Constants ──

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const DEFAULT_WS_PORT = 9100;
const WS_INFO_DIR = path.join(os.homedir(), '.codex', 'bridge');
const WS_INFO_FILE = path.join(WS_INFO_DIR, 'ws-url');
const DISCORD_FORWARD_SEPARATOR = '\n[[CTI_DISCORD_SPLIT]]\n';

// ── Helpers ──

function getWsPort(): number {
  return parseInt(process.env.CTI_CODEX_WS_PORT || '', 10) || DEFAULT_WS_PORT;
}

function toApprovalPolicy(permissionMode?: string): string {
  // CTI_CODEX_APPROVAL_POLICY overrides everything
  const override = process.env.CTI_CODEX_APPROVAL_POLICY;
  if (override) return override;

  switch (permissionMode) {
    case 'acceptEdits': return 'on-failure';
    case 'plan': return 'on-request';
    case 'default': return 'on-request';
    default: return 'never';
  }
}

function shouldPassModelToCodex(): boolean {
  return process.env.CTI_CODEX_PASS_MODEL === 'true';
}

function shouldSkipGitRepoCheck(): boolean {
  return process.env.CTI_CODEX_SKIP_GIT_REPO_CHECK === 'true';
}

function shouldRetryFreshThread(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('resuming session with different model') ||
    lower.includes('no such session') ||
    (lower.includes('resume') && lower.includes('session'))
  );
}

function filterForwardedAgentText(text: string): string {
  const prefix = process.env.CTI_DISCORD_FORWARD_PREFIX?.trim();
  if (!prefix) return text;
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalized = text.replace(/\r\n/g, '\n');
  const pattern = new RegExp(
    `(?:^|\\n)\\s*${escapedPrefix}\\s*([\\s\\S]*?)(?=(?:\\n\\s*${escapedPrefix}\\s*)|$)`,
    'g',
  );

  const parts: string[] = [];
  for (const match of normalized.matchAll(pattern)) {
    const content = (match[1] || '').trim();
    if (content) parts.push(content);
  }

  if (parts.length === 0) return '';
  return parts.map((part) => `${DISCORD_FORWARD_SEPARATOR}${part}`).join('');
}

export function extractForwardBlocks(
  text: string,
  allowTrailing: boolean,
): string[] {
  const prefix = process.env.CTI_DISCORD_FORWARD_PREFIX?.trim();
  if (!prefix) return [];

  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalized = text.replace(/\r\n/g, '\n');
  const pattern = new RegExp(
    `(?:^|\\n)\\s*${escapedPrefix}\\s*([\\s\\S]*?)(?=(?:\\n\\s*${escapedPrefix}\\s*)|$)`,
    'g',
  );

  const matches = Array.from(normalized.matchAll(pattern));
  if (matches.length === 0) return [];

  const completeMatches = allowTrailing ? matches : matches.slice(0, -1);
  return completeMatches
    .map((match) => (match[1] || '').trim())
    .filter(Boolean);
}

// ── JSON-RPC 2.0 Client over WebSocket ──

interface JsonRpcNotification {
  method: string;
  params: Record<string, unknown>;
}

type NotificationHandler = (msg: JsonRpcNotification) => void;

class AppServerClient {
  private ws: WebSocket | null = null;
  proc: ChildProcess | null = null;
  private pending = new Map<number, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
  }>();
  private nextId = 1;
  private notificationHandler: NotificationHandler | null = null;
  private closed = false;
  readonly wsUrl: string;

  constructor(port: number) {
    this.wsUrl = `ws://127.0.0.1:${port}`;
  }

  /** Spawn codex app-server with WebSocket listener and connect. */
  async start(cwd?: string): Promise<void> {
    const env: Record<string, string> = { ...process.env as Record<string, string> };

    // Pass through API credentials
    const apiKey = process.env.CTI_CODEX_API_KEY
      || process.env.CODEX_API_KEY
      || process.env.OPENAI_API_KEY;
    if (apiKey) env.OPENAI_API_KEY = apiKey;

    const baseUrl = process.env.CTI_CODEX_BASE_URL;
    if (baseUrl) env.OPENAI_BASE_URL = baseUrl;

    this.proc = spawn('codex', ['app-server', '--listen', this.wsUrl], {
      cwd: cwd || process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: true,  // Own process group so we can kill the entire tree
    });

    // Log stderr for debugging
    let stderrBuf = '';
    this.proc.stderr?.setEncoding('utf8');
    this.proc.stderr?.on('data', (chunk: string) => {
      stderrBuf += chunk;
      if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
    });

    this.proc.on('exit', (code, signal) => {
      if (stderrBuf.trim()) {
        console.error('[app-server] stderr:', stderrBuf.trim().slice(-1024));
      }
      console.log(`[app-server] exited (code=${code}, signal=${signal})`);
      this.closed = true;
      for (const p of this.pending.values()) {
        p.reject(new Error(`app-server exited (code=${code})`));
      }
      this.pending.clear();
    });

    // Wait for WebSocket to become available
    await this.waitForWs(8000);

    // Persist WS URL for TUI script
    fs.mkdirSync(WS_INFO_DIR, { recursive: true });
    fs.writeFileSync(WS_INFO_FILE, this.wsUrl);

    // JSON-RPC initialize handshake
    await this.request('initialize', {
      clientInfo: {
        name: 'claude-to-im-bridge',
        title: 'Discord Bridge',
        version: '1.0.0',
      },
      capabilities: {
        experimentalApi: false,
        optOutNotificationMethods: [
          'item/reasoning/summaryTextDelta',
          'item/reasoning/summaryPartAdded',
          'item/reasoning/textDelta',
        ],
      },
    });
    this.notify('initialized');
  }

  /** Retry WebSocket connection until app-server is ready. */
  private async waitForWs(timeoutMs: number): Promise<void> {
    const start = Date.now();
    let lastErr: Error | undefined;
    while (Date.now() - start < timeoutMs) {
      if (this.closed) {
        throw new Error('app-server process exited before WebSocket became available');
      }
      try {
        await this.connectWs();
        return;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        await new Promise(r => setTimeout(r, 300));
      }
    }
    throw new Error(`Failed to connect to app-server at ${this.wsUrl} within ${timeoutMs}ms: ${lastErr?.message}`);
  }

  private connectWs(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('ws connect timeout'));
      }, 3000);

      ws.onopen = () => {
        clearTimeout(timeout);
        this.ws = ws;
        resolve();
      };
      ws.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error('ws connect failed'));
      };
      ws.onmessage = (event) => {
        this.handleMessage(String(event.data));
      };
      ws.onclose = () => {
        this.ws = null;
      };
    });
  }

  private handleMessage(data: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data);
    } catch {
      console.warn('[app-server] Failed to parse message:', data.slice(0, 200));
      return;
    }

    // Response to our request
    if (msg.id !== undefined && !msg.method) {
      const pending = this.pending.get(msg.id as number);
      if (!pending) return;
      this.pending.delete(msg.id as number);
      if (msg.error) {
        const errObj = msg.error as { message?: string; code?: number };
        pending.reject(new Error(errObj.message || `RPC error ${errObj.code}`));
      } else {
        pending.resolve(msg.result ?? {});
      }
      return;
    }

    // Server-initiated request (reject — we don't handle these)
    if (msg.id !== undefined && msg.method) {
      this.send({
        id: msg.id,
        error: { code: -32601, message: `Unsupported server request: ${msg.method}` },
      });
      return;
    }

    // Notification (no id, has method)
    if (msg.method && this.notificationHandler) {
      this.notificationHandler({
        method: msg.method as string,
        params: (msg.params ?? {}) as Record<string, unknown>,
      });
    }
  }

  private send(message: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed) {
      throw new Error('app-server client is closed');
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown = {}): void {
    try {
      this.send({ jsonrpc: '2.0', method, params });
    } catch { /* ignore if closed */ }
  }

  setNotificationHandler(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  async close(): Promise<void> {
    try { fs.unlinkSync(WS_INFO_FILE); } catch { /* ignore */ }
    this.closed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM');
      // Grace period then force kill
      setTimeout(() => {
        if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
          this.proc.kill('SIGKILL');
        }
      }, 2000).unref?.();
      this.proc = null;
    }
  }
}

// ── CodexProvider (LLMProvider implementation) ──

export class CodexProvider implements LLMProvider {
  private client: AppServerClient | null = null;

  /** Maps bridge session IDs → Codex thread IDs for resume. */
  private threadIds = new Map<string, string>();

  constructor(private pendingPerms: PendingPermissions) {
    // Synchronous cleanup: kill app-server child tree when daemon exits.
    // process.on('exit') is synchronous — async close() won't finish in time.
    const killChildren = () => {
      const proc = this.client?.proc;
      if (proc?.pid && !proc.killed) {
        try {
          // Kill the entire process group (app-server + its children)
          process.kill(-proc.pid, 'SIGTERM');
        } catch {
          try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        }
      }
      try { fs.unlinkSync(WS_INFO_FILE); } catch { /* ignore */ }
    };
    process.on('exit', killChildren);
    process.on('SIGTERM', () => { killChildren(); process.exit(0); });
    process.on('SIGINT', () => { killChildren(); process.exit(0); });
  }

  private async ensureClient(cwd?: string): Promise<AppServerClient> {
    // Check if existing client is still alive
    if (this.client) {
      const proc = this.client.proc;
      if (proc && proc.exitCode === null && !proc.killed) {
        return this.client;
      }
      // App-server died — clean up and recreate
      console.warn('[codex-provider] app-server died, recreating...');
      await this.client.close().catch(() => {});
      this.client = null;
    }

    const port = getWsPort();
    this.client = new AppServerClient(port);
    await this.client.start(cwd);

    console.log(`[codex-provider] ✓ app-server running at ${this.client.wsUrl}`);
    console.log(`[codex-provider] TUI command: codex resume --remote ${this.client.wsUrl}`);
    return this.client;
  }

  streamChat(params: StreamChatParams): ReadableStream<string> {
    const self = this;

    return new ReadableStream<string>({
      start(controller) {
        (async () => {
          const tempFiles: string[] = [];
          try {
            const client = await self.ensureClient(params.workingDirectory);

            // ── Resolve thread ──
            const inMemoryThreadId = self.threadIds.get(params.sessionId);
            let savedThreadId = inMemoryThreadId || params.sdkSessionId || undefined;

            const approvalPolicy = toApprovalPolicy(params.permissionMode);
            const passModel = shouldPassModelToCodex();

            const threadOpts: Record<string, unknown> = {
              ...(passModel && params.model ? { model: params.model } : {}),
              ...(params.workingDirectory ? { workingDirectory: params.workingDirectory } : {}),
              ...(shouldSkipGitRepoCheck() ? { skipGitRepoCheck: true } : {}),
              approvalPolicy,
              sandbox: process.env.CTI_CODEX_SANDBOX_MODE || 'danger-full-access',
            };

            // ── Build input (text + optional images) ──
            const imageFiles = params.files?.filter(
              f => f.type.startsWith('image/')
            ) ?? [];

            const input: Array<Record<string, string>> = [
              { type: 'text', text: params.prompt },
            ];
            for (const file of imageFiles) {
              const ext = MIME_EXT[file.type] || '.png';
              const tmpPath = path.join(
                os.tmpdir(),
                `cti-img-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
              );
              fs.writeFileSync(tmpPath, Buffer.from(file.data, 'base64'));
              tempFiles.push(tmpPath);
              input.push({ type: 'local_image', path: tmpPath });
            }

            let retryFresh = false;
            const streamedAgentMessageIds = new Set<string>();
            const forwardState = new Map<string, { raw: string; sentCount: number }>();

            while (true) {
              // ── Start or resume thread ──
              let threadId: string;
              if (savedThreadId) {
                try {
                  const res = await client.request<{ thread: { id: string } }>(
                    'thread/resume',
                    { threadId: savedThreadId, ...threadOpts },
                  );
                  threadId = res.thread.id;
                } catch {
                  const res = await client.request<{ thread: { id: string } }>(
                    'thread/start',
                    threadOpts,
                  );
                  threadId = res.thread.id;
                }
              } else {
                const res = await client.request<{ thread: { id: string } }>(
                  'thread/start',
                  threadOpts,
                );
                threadId = res.thread.id;
              }

              self.threadIds.set(params.sessionId, threadId);
              controller.enqueue(sseEvent('status', { session_id: threadId }));

              // ── Stream turn via notifications ──
              let sawAnyNotification = false;

              const turnDone = new Promise<void>((resolve, reject) => {
                client.setNotificationHandler((notification) => {
                  if (params.abortController?.signal.aborted) {
                    resolve();
                    return;
                  }

                  sawAnyNotification = true;
                  const { method, params: np } = notification;

                  switch (method) {
                    case 'item/agentMessage/delta': {
                      const itemId = (np?.itemId as string | undefined) || '';
                      const delta = (np?.delta as string | undefined) || '';
                      if (!itemId || !delta) break;

                      const state = forwardState.get(itemId) || { raw: '', sentCount: 0 };
                      state.raw += delta;
                      const blocks = extractForwardBlocks(state.raw, false);
                      if (blocks.length > state.sentCount) {
                        streamedAgentMessageIds.add(itemId);
                        for (const block of blocks.slice(state.sentCount)) {
                          controller.enqueue(sseEvent('text', `${DISCORD_FORWARD_SEPARATOR}${block}`));
                        }
                        state.sentCount = blocks.length;
                      }
                      forwardState.set(itemId, state);
                      break;
                    }

                    case 'item/completed': {
                      const item = np?.item as Record<string, unknown> | undefined;
                      if (item) {
                        const itemType = item.type as string;
                        const itemId = (item.id as string | undefined) || '';
                        if ((itemType === 'agent_message' || itemType === 'agentMessage') && itemId) {
                          const state = forwardState.get(itemId);
                          if (state) {
                            const finalText = (item.text as string | undefined) || state.raw;
                            const blocks = extractForwardBlocks(finalText, true);
                            if (blocks.length > state.sentCount) {
                              streamedAgentMessageIds.add(itemId);
                              for (const block of blocks.slice(state.sentCount)) {
                                controller.enqueue(sseEvent('text', `${DISCORD_FORWARD_SEPARATOR}${block}`));
                              }
                            }
                            forwardState.delete(itemId);
                          }
                        }
                        self.handleCompletedItem(controller, item, streamedAgentMessageIds);
                      }
                      break;
                    }

                    case 'turn/completed': {
                      const usage = np?.usage as Record<string, unknown> | undefined;
                      controller.enqueue(sseEvent('result', {
                        usage: usage ? {
                          input_tokens: usage.inputTokens ?? usage.input_tokens ?? 0,
                          output_tokens: usage.outputTokens ?? usage.output_tokens ?? 0,
                          cache_read_input_tokens: usage.cachedInputTokens ?? usage.cached_input_tokens ?? 0,
                        } : undefined,
                        session_id: threadId,
                      }));
                      resolve();
                      break;
                    }

                    case 'turn/failed': {
                      const errMsg =
                        (np?.error as { message?: string })?.message
                        || np?.message as string
                        || 'Turn failed';
                      reject(new Error(errMsg as string));
                      break;
                    }

                    // item/started, item/updated, turn/started — no action needed
                  }
                });
              });

              try {
                await client.request('turn/start', { threadId, input });
                await turnDone;
                break; // success — exit retry loop
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (
                  savedThreadId &&
                  !retryFresh &&
                  !sawAnyNotification &&
                  shouldRetryFreshThread(message)
                ) {
                  console.warn('[codex-provider] Resume failed, retrying fresh:', message);
                  savedThreadId = undefined;
                  retryFresh = true;
                  continue;
                }
                throw err;
              }
            }

            controller.close();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(
              '[codex-provider] Error:',
              err instanceof Error ? err.stack || err.message : err,
            );
            try {
              controller.enqueue(sseEvent('error', message));
              controller.close();
            } catch {
              // Controller already closed
            }
          } finally {
            for (const tmp of tempFiles) {
              try { fs.unlinkSync(tmp); } catch { /* ignore */ }
            }
          }
        })();
      },
    });
  }

  /**
   * Map a completed Codex item to SSE events.
   * Handles both camelCase (app-server wire format) and snake_case (legacy).
   */
  private handleCompletedItem(
    controller: ReadableStreamDefaultController<string>,
    item: Record<string, unknown>,
    streamedAgentMessageIds?: Set<string>,
  ): void {
    const itemType = item.type as string;

    switch (itemType) {
      case 'agent_message':
      case 'agentMessage': {
        const itemId = (item.id as string | undefined) || '';
        if (itemId && streamedAgentMessageIds?.has(itemId)) {
          break;
        }
        const text = filterForwardedAgentText((item.text as string) || '');
        if (text) {
          controller.enqueue(sseEvent('text', text));
        }
        break;
      }

      case 'command_execution':
      case 'commandExecution': {
        const toolId = (item.id as string) || `tool-${Date.now()}`;
        const command = (item.command as string) || '';
        const output =
          (item.aggregatedOutput as string)
          || (item.aggregated_output as string)
          || '';
        const exitCode =
          (item.exitCode as number | undefined)
          ?? (item.exit_code as number | undefined);
        const isError = exitCode != null && exitCode !== 0;

        controller.enqueue(sseEvent('tool_use', {
          id: toolId,
          name: 'Bash',
          input: { command },
        }));

        const resultContent = output || (isError ? `Exit code: ${exitCode}` : 'Done');
        controller.enqueue(sseEvent('tool_result', {
          tool_use_id: toolId,
          content: resultContent,
          is_error: isError,
        }));
        break;
      }

      case 'file_change':
      case 'fileChange': {
        const toolId = (item.id as string) || `tool-${Date.now()}`;
        const changes = (item.changes as Array<{ path: string; kind: string }>) || [];
        const summary = changes.map(c => `${c.kind}: ${c.path}`).join('\n');

        controller.enqueue(sseEvent('tool_use', {
          id: toolId,
          name: 'Edit',
          input: { files: changes },
        }));

        controller.enqueue(sseEvent('tool_result', {
          tool_use_id: toolId,
          content: summary || 'File changes applied',
          is_error: false,
        }));
        break;
      }

      case 'mcp_tool_call':
      case 'mcpToolCall': {
        const toolId = (item.id as string) || `tool-${Date.now()}`;
        const server = (item.server as string) || '';
        const tool = (item.tool as string) || '';
        const args = item.arguments as unknown;
        const result = item.result as { content?: unknown; structured_content?: unknown; structuredContent?: unknown } | undefined;
        const error = item.error as { message?: string } | undefined;

        const resultContent = result?.content ?? result?.structured_content ?? result?.structuredContent;
        const resultText = typeof resultContent === 'string'
          ? resultContent
          : (resultContent ? JSON.stringify(resultContent) : undefined);

        controller.enqueue(sseEvent('tool_use', {
          id: toolId,
          name: `mcp__${server}__${tool}`,
          input: args,
        }));

        controller.enqueue(sseEvent('tool_result', {
          tool_use_id: toolId,
          content: error?.message || resultText || 'Done',
          is_error: !!error,
        }));
        break;
      }

      case 'reasoning': {
        const text = (item.text as string) || '';
        if (text) {
          controller.enqueue(sseEvent('status', { reasoning: text }));
        }
        break;
      }
    }
  }
}
