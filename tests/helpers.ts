import type { PluginBackendContext, PluginInstructions, PluginTools } from "learnharness-plugin-api";

/** The event shape passed to backend `ctx.events.on` listeners (not exported by the SDK by name). */
export type ServerEvent = Parameters<Parameters<PluginBackendContext["events"]["on"]>[0]>[0];

export type FakeSessions = Map<string, { updatedAt: string; messages: unknown[] }>;

/** Minimal fake of the public backend context, shared by backend and frontend tests. */
export function fakeHost(dataDirectory: string, sessions: FakeSessions) {
  const instructions = new Map<number, PluginInstructions>();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const emitted: { topic: string; data?: unknown }[] = [];
  const listeners: ((event: ServerEvent) => void)[] = [];
  let tools: PluginTools | undefined;
  let nextInstruction = 0;
  const ctx = {
    dataDirectory,
    signal: new AbortController().signal,
    events: { emit(topic: string, data?: unknown) { emitted.push({ topic, data }); }, on(listener: (event: ServerEvent) => void) { listeners.push(listener); return () => {}; } },
    registerInstructions(value: PluginInstructions) { const id = nextInstruction++; instructions.set(id, value); return () => { instructions.delete(id); }; },
    registerTools(value: PluginTools) { tools = value; return () => { tools = undefined; }; },
    handle(name: string, handler: (input: unknown) => unknown) { handlers.set(name, handler); return () => {}; },
    learning: {
      listSessions: () => [...sessions].map(([id, value]) => ({ id, updatedAt: value.updatedAt })),
      getSession: (id: string) => sessions.has(id) ? { id, ...sessions.get(id)! } : null,
      graph: () => ({ nodes: [], propositions: Array.from({ length: 10 }, (_, index) => ({ id: `n${index}`, createdAt: "2026-11-01T12:00:00Z" })) }),
    },
  };
  return {
    ctx: ctx as unknown as PluginBackendContext,
    call: (name: string, input: unknown = {}) => Promise.resolve(handlers.get(name)!(input)) as Promise<any>,
    instructions: () => [...instructions.values()],
    tools: (chatId = "chat-1") => tools?.create({ chatId, agent: "teacher" }) ?? [],
    fire: (event: ServerEvent) => { for (const listener of listeners) listener(event); },
    emitted,
  };
}
