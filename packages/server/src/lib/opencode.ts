import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AppError } from "./errors";

/**
 * RULE 21.1.6 - the OpenCode integration boundary.
 *
 * This module is the ONLY place in Nexora that knows how to reach OpenCode.
 * Provider discovery, model discovery, connection verification and execution
 * all go through here, so the whole product can be repointed at a different
 * execution layer later without touching a single feature (RULE 21.1.15).
 *
 * Nothing in this file invents a provider, a model, an availability state or a
 * response. Every value it returns came out of the real `opencode` executable
 * in this process's real environment (RULE 21.1.7, RULE 21.1.8).
 */

/** OpenCode's own zero-credential provider. Its catalogue is the free tier. */
const OPENCODE_FREE_PROVIDER = "opencode";

const MODELS_TIMEOUT_MS = 120_000;
const RUN_TIMEOUT_MS = 180_000;
/**
 * Verification is an infrequent administrative action performed on demand, so
 * it is given a wider budget than an interactive answer: a slow provider must
 * not make a correct configuration look unverified. It is still bounded.
 */
const VERIFY_RUN_TIMEOUT_MS = 240_000;
const MODELS_CACHE_MS = 60_000;

export interface OpenCodeModelRef {
  /** `provider/model`, the identifier OpenCode itself uses. */
  ref: string;
  provider: string;
  model: string;
  /**
   * Derived from what OpenCode reports, never from a stored list. A model is
   * free when OpenCode serves it from its own free provider, or when the
   * provider's own identifier marks it free.
   */
  free: boolean;
}

export interface OpenCodeProviderRef {
  id: string;
  free: boolean;
  modelCount: number;
}

export interface OpenCodeCatalogue {
  providers: OpenCodeProviderRef[];
  models: OpenCodeModelRef[];
  openCodeVersion: string | null;
  fetchedAt: string;
}

export interface OpenCodeRunResult {
  text: string;
  provider: string;
  model: string;
  sessionId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface OpenCodeVerifyResult {
  ok: boolean;
  provider: string;
  model: string;
  /** The real reason a verification failed. Never a fabricated success. */
  failure: string | null;
  checkedAt: string;
  latencyMs: number;
}

/** The subset of the parent environment a child process may ever inherit. */
const ENV_ALLOW_LIST = [
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "SystemRoot",
  "SYSTEMROOT",
  "SystemDrive",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "ComSpec",
  "LANG",
  "LC_ALL",
  "TZ",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OPENCODE_DISABLE_AUTOUPDATE",
  "OPENCODE_DISABLE_TELEMETRY",
  "NO_COLOR",
  "CI"
] as const;

/**
 * A provider's API key never enters the process environment of the Nexora
 * server. It is handed to one child process, under the name that provider's
 * SDK reads, and dies with it. No inherited key from the server's own
 * environment can ever be used for a company's request, so one company can
 * never be served with another company's credential (RULE 21.1.10, RULE 21.3.3).
 */
export function providerApiKeyEnvName(provider: string): string {
  const normalised = provider
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return `${normalised || "OPENCODE"}_API_KEY`;
}

function baseEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const name of ENV_ALLOW_LIST) {
    const value = process.env[name];
    if (typeof value === "string") out[name] = value;
  }
  return out;
}

/**
 * Resolves the real OpenCode executable.
 *
 * `spawn` cannot run a Windows `.cmd`/`.ps1` shim without a shell, and a shell
 * would be the wrong thing to wrap a provider execution in. So the executable
 * itself is located: an explicit override, the npm package binary behind the
 * shim, or a plain `opencode` on PATH for POSIX installs. If none of those
 * exist, OpenCode is genuinely unavailable and RULE 21.1.8 is not satisfied, so
 * the caller is told rather than being handed a mock.
 */
let resolvedCommand: string | null = null;

function pathDirs(): string[] {
  const raw = process.env.PATH ?? process.env.Path ?? "";
  return raw.split(process.platform === "win32" ? ";" : ":").filter(Boolean);
}

function exists(candidate: string): boolean {
  try {
    return existsSync(candidate);
  } catch {
    return false;
  }
}

function candidateCommands(): string[] {
  const out: string[] = [];
  if (process.env.OPENCODE_BIN) out.push(process.env.OPENCODE_BIN);

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) out.push(join(appData, "npm", "node_modules", "opencode-ai", "bin", "opencode.exe"));
    // The npm shim directory: <shim dir>/node_modules/opencode-ai/bin.
    for (const dir of pathDirs()) {
      out.push(join(dir, "node_modules", "opencode-ai", "bin", "opencode.exe"));
    }
    out.push("opencode.exe");
  } else {
    out.push("opencode");
  }
  return out;
}

function resolveCommand(): string | null {
  if (resolvedCommand) return resolvedCommand;
  for (const candidate of candidateCommands()) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (exists(candidate)) {
        resolvedCommand = candidate;
        return resolvedCommand;
      }
      continue;
    }
    // A bare name is on PATH. `which` is not portable enough to rely on, so a
    // plain existence probe per PATH directory is used instead.
    const suffixes = process.platform === "win32" ? [".exe", ".cmd"] : [""];
    for (const dir of pathDirs()) {
      for (const suffix of suffixes) {
        const full = join(dir, `${candidate}${suffix}`);
        if (exists(full)) {
          resolvedCommand = full;
          return resolvedCommand;
        }
      }
    }
  }
  return null;
}

/** Test seam: forces the next resolution to run again. */
export function resetOpenCodeCommandCache(): void {
  resolvedCommand = null;
}

interface SpawnResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function spawnOpenCode(
  args: string[],
  opts: { timeoutMs: number; extraEnv?: Record<string, string>; cwd?: string }
): Promise<SpawnResult> {
  const command = resolveCommand();
  if (!command) {
    return Promise.reject(
      new OpenCodeUnavailableError(
        "OpenCode is not installed for this platform, so the AI capability cannot run"
      )
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...baseEnv(), ...(opts.extraEnv ?? {}) },
      cwd: opts.cwd ?? process.cwd(),
      windowsHide: true,
      shell: false
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    // OpenCode reads stdin while it works and does not run until stdin reaches
    // EOF. A spawned child must therefore be told immediately that no further
    // input is coming, or the execution never starts.
    child.stdin?.end();
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

/**
 * Removes anything that could be a credential from text that will be surfaced.
 * Only well-known secret shapes are targeted, so an ordinary tenant label or
 * identifier in the same message stays readable.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|pk|key|secret|token|bearer)-[A-Za-z0-9_-]{8,}/gi, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, "Bearer [redacted]")
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, "[redacted]")
    .slice(0, 400);
}

export class OpenCodeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenCodeUnavailableError";
  }
}

/** Confirms the real executable is present, as RULE 21.1.8 requires. */
export async function assertOpenCodeInstalled(): Promise<{ version: string | null }> {
  let result: SpawnResult;
  try {
    result = await spawnOpenCode(["--version"], { timeoutMs: 30_000 });
  } catch (err) {
    throw new OpenCodeUnavailableError(
      "OpenCode is not available to this installation, so the AI capability cannot run"
    );
  }
  if (result.timedOut) {
    throw new OpenCodeUnavailableError("OpenCode did not respond to a version check");
  }
  if (result.code !== 0) {
    throw new OpenCodeUnavailableError(
      `OpenCode is installed but not runnable (exit ${result.code ?? "signal " + result.signal})`
    );
  }
  return { version: result.stdout.trim() || result.stderr.trim() || null };
}

function parseModelLines(stdout: string): OpenCodeModelRef[] {
  const seen = new Set<string>();
  const out: OpenCodeModelRef[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const slash = line.indexOf("/");
    if (slash <= 0 || slash === line.length - 1) continue;
    const provider = line.slice(0, slash);
    const model = line.slice(slash + 1);
    if (!/^[A-Za-z0-9._-]+$/.test(provider) || !/^[A-Za-z0-9._/-]+$/.test(model)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push({
      ref: line,
      provider,
      model,
      free: provider === OPENCODE_FREE_PROVIDER || /(^|[-_.])free$/i.test(model)
    });
  }
  return out;
}

let catalogueCache: { at: number; value: OpenCodeCatalogue } | null = null;

/**
 * The live provider and model catalogue, straight from OpenCode. Cached briefly
 * so a screen that lists providers and models does not spawn a process per
 * render, but never a hard-coded list (RULE 21.1.7, RULE 21.2.3).
 */
export async function openCodeCatalogue(opts: { refresh?: boolean } = {}): Promise<OpenCodeCatalogue> {
  const now = Date.now();
  if (!opts.refresh && catalogueCache && now - catalogueCache.at < MODELS_CACHE_MS) {
    return catalogueCache.value;
  }
  // The executable is large and can be slow to start on a loaded machine, so
  // one retry is made before reporting a real outage. A failure that survives
  // both attempts is reported as itself - never as an empty catalogue.
  let modelsResult = await spawnOpenCode(["models"], { timeoutMs: MODELS_TIMEOUT_MS });
  if (modelsResult.timedOut || modelsResult.code !== 0) {
    modelsResult = await spawnOpenCode(["models"], { timeoutMs: MODELS_TIMEOUT_MS });
  }
  const versionResult = await spawnOpenCode(["--version"], { timeoutMs: 30_000 });
  if (modelsResult.timedOut) {
    throw new OpenCodeUnavailableError("OpenCode did not return a model catalogue in time");
  }
  if (modelsResult.code !== 0) {
    throw new OpenCodeUnavailableError(
      `OpenCode could not list models (exit ${modelsResult.code ?? "signal " + modelsResult.signal})`
    );
  }
  const models = parseModelLines(modelsResult.stdout);
  if (models.length === 0) {
    throw new OpenCodeUnavailableError("OpenCode reported an empty model catalogue");
  }
  const byProvider = new Map<string, OpenCodeModelRef[]>();
  for (const model of models) {
    const list = byProvider.get(model.provider) ?? [];
    list.push(model);
    byProvider.set(model.provider, list);
  }
  const providers: OpenCodeProviderRef[] = [...byProvider.entries()]
    .map(([id, list]) => ({
      id,
      free: id === OPENCODE_FREE_PROVIDER || list.every((m) => m.free),
      modelCount: list.length
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const catalogue: OpenCodeCatalogue = {
    providers,
    models,
    openCodeVersion: versionResult.stdout.trim() || null,
    fetchedAt: new Date(now).toISOString()
  };
  catalogueCache = { at: now, value: catalogue };
  return catalogue;
}

/**
 * RULE 21.2.2 - the FREE MODELS list. It is whatever OpenCode currently
 * reports as genuinely free. A model that is merely named in a document is not
 * evidence of availability, so none is ever shown on that basis.
 */
export async function openCodeFreeModels(): Promise<OpenCodeModelRef[]> {
  const catalogue = await openCodeCatalogue();
  return catalogue.models.filter((m) => m.free).sort((a, b) => a.ref.localeCompare(b.ref));
}

/** RULE 21.2.4 - the live model list for one provider. */
export async function openCodeProviderModels(
  provider: string
): Promise<{ provider: string; models: OpenCodeModelRef[]; fetchedAt: string }> {
  const catalogue = await openCodeCatalogue();
  const known = catalogue.providers.find((p) => p.id === provider);
  if (!known) {
    throw AppError.unprocessable(`${provider} is not a provider OpenCode currently offers`);
  }
  return {
    provider,
    models: catalogue.models.filter((m) => m.provider === provider).sort((a, b) => a.ref.localeCompare(b.ref)),
    fetchedAt: catalogue.fetchedAt
  };
}

function parseRunEvents(stdout: string): {
  text: string;
  sessionId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
} {
  let text = "";
  let sessionId: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let costUsd: number | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: {
      type?: string;
      sessionID?: string;
      part?: {
        text?: string;
        tokens?: { input?: number; output?: number };
        cost?: number;
      };
    };
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (event.sessionID && !sessionId) sessionId = event.sessionID;
    if (event.type === "text" && typeof event.part?.text === "string") {
      text += event.part.text;
    }
    if (event.type === "step_finish" && event.part) {
      if (typeof event.part.tokens?.input === "number") inputTokens = event.part.tokens.input;
      if (typeof event.part.tokens?.output === "number") outputTokens = event.part.tokens.output;
      if (typeof event.part.cost === "number") costUsd = event.part.cost;
    }
  }
  return { text: text.trim(), sessionId, inputTokens, outputTokens, costUsd };
}

export interface OpenCodeExecuteInput {
  provider: string;
  model: string;
  apiKey?: string | null;
  system?: string | null;
  prompt: string;
  timeoutMs?: number;
  /** Tenant label used only for concurrency accounting and logs. Never a secret. */
  tenantLabel: string;
}

/**
 * RULE 21.1.9 / RULE 21.3.5 - a real execution of the exact provider/model the
 * company selected, with that company's own credential, through OpenCode.
 * A failure is reported as the real failure it was; nothing is substituted.
 */
export async function executeThroughOpenCode(
  input: OpenCodeExecuteInput
): Promise<OpenCodeRunResult> {
  const { tenantLabel, prompt, provider, model, apiKey } = input;
  if (!prompt.trim()) throw AppError.unprocessable("The AI prompt must not be empty");

  const modelRef = model.includes("/") ? model : `${provider}/${model}`;
  if (!modelRef.startsWith(`${provider}/`)) {
    throw AppError.unprocessable("The selected model does not belong to the selected provider");
  }

  const extraEnv: Record<string, string> = {};
  if (apiKey && provider !== OPENCODE_FREE_PROVIDER) {
    extraEnv[providerApiKeyEnvName(provider)] = apiKey;
  }

  const fullPrompt = input.system?.trim()
    ? `${input.system.trim()}\n\n---\n\n${prompt}`
    : prompt;

  let result: SpawnResult;
  try {
    result = await spawnOpenCode(["run", "--format", "json", "-m", modelRef, fullPrompt], {
      timeoutMs: input.timeoutMs ?? RUN_TIMEOUT_MS,
      extraEnv
    });
  } catch (err) {
    throw new OpenCodeUnavailableError(
      `OpenCode could not be started for tenant ${tenantLabel}: ${(err as Error).message}`
    );
  }

  if (result.timedOut) {
    throw AppError.gatewayTimeout(
      `The ${provider}/${model} execution did not complete in time for tenant ${tenantLabel}`
    );
  }
  if (result.code !== 0) {
    // stderr can echo a rejected key; it is never stored, logged or returned.
    const safe = redactSecrets(
      (result.stderr || result.stdout)
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .slice(-3)
        .join(" ")
    );
    throw AppError.badGateway(
      `The ${provider}/${model} execution failed for tenant ${tenantLabel}: ${safe || `exit ${result.code}`}`
    );
  }

  const parsed = parseRunEvents(result.stdout);
  if (!parsed.text) {
    throw AppError.badGateway(
      `The ${provider}/${model} execution returned no answer for tenant ${tenantLabel}`
    );
  }
  return {
    text: parsed.text,
    provider,
    model,
    sessionId: parsed.sessionId,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    costUsd: parsed.costUsd
  };
}

/**
 * RULE 21.1.12 - Verify is a real verification. The model must exist in the
 * provider's live catalogue, and a real execution must succeed with the
 * entered credential. A configuration is only ever marked verified from a real
 * successful execution.
 */
export async function verifyThroughOpenCode(input: {
  provider: string;
  model: string;
  apiKey?: string | null;
  tenantLabel: string;
}): Promise<OpenCodeVerifyResult> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  const { provider, model, apiKey, tenantLabel } = input;

  try {
    const available = await openCodeProviderModels(provider);
    const ref = model.includes("/") ? model : `${provider}/${model}`;
    if (!available.models.some((m) => m.ref === ref)) {
      return {
        ok: false,
        provider,
        model: ref,
        failure: `${ref} is not currently offered by ${provider} through OpenCode`,
        checkedAt,
        latencyMs: Date.now() - startedAt
      };
    }
    const run = await executeThroughOpenCode({
      provider,
      model: ref.split("/").slice(1).join("/"),
      apiKey,
      tenantLabel,
      system:
        "You are a connectivity probe for a financial platform. Answer with the single word CONNECTED and nothing else.",
      prompt: "Confirm the connection.",
      timeoutMs: VERIFY_RUN_TIMEOUT_MS
    });
    return {
      ok: true,
      provider,
      model: ref,
      failure: null,
      checkedAt,
      latencyMs: Date.now() - startedAt
    };
  } catch (err) {
    const message =
      err instanceof OpenCodeUnavailableError || err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      provider,
      model: model.includes("/") ? model : `${provider}/${model}`,
      failure: redactSecrets(message),
      checkedAt,
      latencyMs: Date.now() - startedAt
    };
  }
}

/** A non-reversible label for a secret, safe to show and to store. */
export function secretFingerprint(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return `sha256:${createHash("sha256").update(secret).digest("hex").slice(0, 16)}`;
}

/** Exposed for tests and diagnostics: the free provider's identifier. */
export const FREE_PROVIDER_ID = OPENCODE_FREE_PROVIDER;
