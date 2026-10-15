import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { readRegularFileText } from "./regular-file";

const STORE_VERSION = 1;
const STORE_MAX_BYTES = 4 * 1024 * 1024;
const PAIR_TTL_MS = 2 * 60_000;
const DEVICE_ONLINE_MS = 2 * 60_000;
const DEVICE_WAIT_MS = 25_000;
const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LOCK_OPTIONS = {
  realpath: false,
  stale: 10_000,
  retries: { retries: 10, factor: 2, minTimeout: 25, maxTimeout: 500 },
  onCompromised: (error: Error) => {
    console.warn(`[pi-web] the Chrome gateway state lock was compromised: ${error.message}`);
  },
};

interface StoredDevice {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: number;
  revokedAt?: number;
}

interface GatewayStore {
  version: 1;
  devices: Record<string, StoredDevice>;
  bindings: Record<string, string>;
}

interface PairRequest {
  sessionId: string;
  expiresAt: number;
  attempts: number;
}

export interface GatewayCommand {
  id: string;
  action: string;
  params: Record<string, unknown>;
  expectedExtensionVersion?: string;
}

interface PendingCommand {
  deviceId: string;
  command: GatewayCommand;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RuntimeDevice {
  lastSeenAt?: number;
  clientName?: string;
  extensionVersion?: string;
}

export class ChromeGatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "ChromeGatewayError";
  }
}

function emptyStore(): GatewayStore {
  return { version: STORE_VERSION, devices: {}, bindings: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStore(text: string | undefined): GatewayStore {
  if (text === undefined) return emptyStore();
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || parsed.version !== STORE_VERSION || !isRecord(parsed.devices) || !isRecord(parsed.bindings)) {
    throw new Error("Invalid pi-chrome gateway store");
  }
  const devices: Record<string, StoredDevice> = {};
  for (const [id, value] of Object.entries(parsed.devices)) {
    if (
      !isRecord(value)
      || value.id !== id
      || typeof value.name !== "string"
      || typeof value.tokenHash !== "string"
      || typeof value.createdAt !== "number"
      || (value.revokedAt !== undefined && typeof value.revokedAt !== "number")
    ) throw new Error("Invalid pi-chrome gateway device");
    devices[id] = value as unknown as StoredDevice;
  }
  const bindings: Record<string, string> = {};
  for (const [sessionId, deviceId] of Object.entries(parsed.bindings)) {
    if (typeof deviceId !== "string") throw new Error("Invalid pi-chrome gateway binding");
    if (devices[deviceId] && !devices[deviceId].revokedAt) bindings[sessionId] = deviceId;
  }
  return { version: STORE_VERSION, devices, bindings };
}

function secretHash(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function tokenMatches(token: string, expectedHex: string): boolean {
  const expected = Buffer.from(expectedHex, "hex");
  const actual = secretHash(token);
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

function cleanName(value: string): string {
  const name = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(name || "Chrome device").slice(0, 80).join("");
}

function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

function displayCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function newPairCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)];
  return code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ChromeGateway {
  private readonly store: GatewayStore;
  private readonly pairRequests = new Map<string, PairRequest>();
  private readonly runtimeDevices = new Map<string, RuntimeDevice>();
  private readonly queues = new Map<string, GatewayCommand[]>();
  private readonly waiters = new Map<string, Set<(command?: GatewayCommand) => void>>();
  private readonly inFlight = new Map<string, string>();
  private readonly pending = new Map<string, PendingCommand>();
  private writeChain = Promise.resolve();

  constructor(private readonly storePath = getChromeGatewayStorePath()) {
    this.store = parseStore(readRegularFileText(storePath, STORE_MAX_BYTES));
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.store, null, 2) + "\n";
    // shortcut: the live command queue is single-process; use a shared broker before running multiple pi-web instances.
    const write = this.writeChain.then(async () => {
      mkdirSync(dirname(this.storePath), { recursive: true });
      const release = await lockfile.lock(this.storePath, LOCK_OPTIONS);
      try {
        writePrivateFileAtomicSync(this.storePath, snapshot);
      } finally {
        await release();
      }
    });
    this.writeChain = write.catch(() => undefined);
    return write;
  }

  private expirePairRequests(now = Date.now()): void {
    for (const [code, request] of this.pairRequests) {
      if (request.expiresAt <= now) this.pairRequests.delete(code);
    }
  }

  createPair(sessionId: string): { code: string; expiresAt: number } {
    if (!sessionId) throw new ChromeGatewayError("session-required", "Session id is required");
    this.expirePairRequests();
    for (const [code, request] of this.pairRequests) {
      if (request.sessionId === sessionId) this.pairRequests.delete(code);
    }
    let raw: string;
    do raw = newPairCode(); while (this.pairRequests.has(raw));
    const expiresAt = Date.now() + PAIR_TTL_MS;
    this.pairRequests.set(raw, { sessionId, expiresAt, attempts: 0 });
    return { code: displayCode(raw), expiresAt };
  }

  async claimPair(input: {
    code: string;
    name: string;
    deviceId?: string;
    token?: string;
  }): Promise<{ deviceId: string; token?: string; name: string; sessionId: string }> {
    this.expirePairRequests();
    const code = normalizeCode(input.code);
    const request = this.pairRequests.get(code);
    if (!request) throw new ChromeGatewayError("pair-invalid", "Pairing code is invalid or expired", 404);
    request.attempts += 1;
    if (request.attempts > 5) {
      this.pairRequests.delete(code);
      throw new ChromeGatewayError("pair-invalid", "Pairing code is invalid or expired", 404);
    }

    const name = cleanName(input.name);
    let device: StoredDevice | undefined;
    let plaintextToken: string | undefined;
    if (input.deviceId || input.token) {
      if (!input.deviceId || !input.token) throw new ChromeGatewayError("device-auth-invalid", "Existing device credentials are incomplete", 401);
      device = this.authenticateDevice(input.deviceId, input.token);
      device.name = name;
    } else {
      plaintextToken = randomBytes(32).toString("base64url");
      const id = randomUUID();
      device = {
        id,
        name,
        tokenHash: secretHash(plaintextToken).toString("hex"),
        createdAt: Date.now(),
      };
      this.store.devices[id] = device;
    }

    this.store.bindings[request.sessionId] = device.id;
    this.pairRequests.delete(code);
    await this.persist();
    return { deviceId: device.id, token: plaintextToken, name: device.name, sessionId: request.sessionId };
  }

  authenticateDevice(deviceId: string, token: string): StoredDevice {
    const device = this.store.devices[deviceId];
    if (!device || device.revokedAt || !tokenMatches(token, device.tokenHash)) {
      throw new ChromeGatewayError("device-auth-invalid", "Device credentials are invalid or revoked", 401);
    }
    return device;
  }

  noteDevice(deviceId: string, token: string, details: { clientName?: string; extensionVersion?: string }): StoredDevice {
    const device = this.authenticateDevice(deviceId, token);
    this.runtimeDevices.set(deviceId, {
      lastSeenAt: Date.now(),
      clientName: details.clientName?.slice(0, 160),
      extensionVersion: details.extensionVersion?.slice(0, 40),
    });
    return device;
  }

  status(sessionId: string): Record<string, unknown> {
    const deviceId = this.store.bindings[sessionId];
    if (!deviceId) return { mode: "gateway", paired: false, connected: false };
    const device = this.store.devices[deviceId];
    if (!device || device.revokedAt) return { mode: "gateway", paired: false, connected: false };
    const runtime = this.runtimeDevices.get(deviceId);
    const connected = typeof runtime?.lastSeenAt === "number" && Date.now() - runtime.lastSeenAt < DEVICE_ONLINE_MS;
    return {
      mode: "gateway",
      paired: true,
      connected,
      deviceId,
      deviceName: device.name,
      lastSeenAt: runtime?.lastSeenAt,
      clientName: runtime?.clientName,
      extensionVersion: runtime?.extensionVersion,
      queuedCommands: this.queues.get(deviceId)?.length ?? 0,
      pendingCommands: [...this.pending.values()].filter((entry) => entry.deviceId === deviceId).length,
    };
  }

  async unpair(sessionId: string): Promise<boolean> {
    if (!this.store.bindings[sessionId]) return false;
    delete this.store.bindings[sessionId];
    await this.persist();
    return true;
  }

  async revokeBoundDevice(sessionId: string): Promise<boolean> {
    const deviceId = this.store.bindings[sessionId];
    if (!deviceId) return false;
    const device = this.store.devices[deviceId];
    if (device && !device.revokedAt) device.revokedAt = Date.now();
    for (const [boundSession, boundDevice] of Object.entries(this.store.bindings)) {
      if (boundDevice === deviceId) delete this.store.bindings[boundSession];
    }
    this.rejectDeviceCommands(deviceId, new ChromeGatewayError("device-revoked", "Chrome device was revoked", 410));
    await this.persist();
    return true;
  }

  sendCommand(
    sessionId: string,
    action: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    expectedExtensionVersion?: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const deviceId = this.store.bindings[sessionId];
    if (!deviceId) return Promise.reject(new ChromeGatewayError("device-unpaired", "No Chrome device is paired with this Pi session. Run /chrome pair.", 409));
    const device = this.store.devices[deviceId];
    if (!device || device.revokedAt) return Promise.reject(new ChromeGatewayError("device-revoked", "The paired Chrome device is revoked. Run /chrome pair again.", 410));
    if (signal?.aborted) return Promise.reject(new ChromeGatewayError("command-aborted", "Chrome command aborted", 499));

    const command: GatewayCommand = { id: randomUUID(), action, params, expectedExtensionVersion };
    return new Promise((resolve, reject) => {
      const finishAbort = () => signal?.removeEventListener("abort", onAbort);
      const onAbort = () => {
        this.removeQueuedCommand(deviceId, command.id);
        const pending = this.pending.get(command.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(command.id);
        }
        if (this.inFlight.get(deviceId) === command.id) this.inFlight.delete(deviceId);
        finishAbort();
        reject(new ChromeGatewayError("command-aborted", "Chrome command aborted", 499));
      };
      const timer = setTimeout(() => {
        this.pending.delete(command.id);
        this.removeQueuedCommand(deviceId, command.id);
        if (this.inFlight.get(deviceId) === command.id) this.inFlight.delete(deviceId);
        finishAbort();
        reject(new ChromeGatewayError("command-timeout", `Chrome device did not return a result within ${timeoutMs}ms`, 504));
      }, timeoutMs);
      this.pending.set(command.id, {
        deviceId,
        command,
        timer,
        resolve: (value) => { finishAbort(); resolve(value); },
        reject: (error) => { finishAbort(); reject(error); },
      });
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      this.enqueue(deviceId, command);
    });
  }

  async nextCommand(
    deviceId: string,
    token: string,
    details: { clientName?: string; extensionVersion?: string },
    signal?: AbortSignal,
  ): Promise<GatewayCommand | undefined> {
    this.noteDevice(deviceId, token, details);
    if (this.inFlight.has(deviceId)) return undefined;
    const queued = this.queues.get(deviceId)?.shift();
    if (queued) {
      this.inFlight.set(deviceId, queued.id);
      return queued;
    }
    if (signal?.aborted) return undefined;

    return new Promise((resolve) => {
      let settled = false;
      const waiters = this.waiters.get(deviceId) ?? new Set();
      this.waiters.set(deviceId, waiters);
      const finish = (command?: GatewayCommand) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        waiters.delete(finish);
        if (waiters.size === 0) this.waiters.delete(deviceId);
        if (command) this.inFlight.set(deviceId, command.id);
        resolve(command);
      };
      const onAbort = () => finish();
      const timer = setTimeout(() => finish(), DEVICE_WAIT_MS);
      waiters.add(finish);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  submitResult(deviceId: string, token: string, result: { id: string; ok: boolean; result?: unknown; error?: string }): void {
    this.noteDevice(deviceId, token, {});
    const pending = this.pending.get(result.id);
    if (!pending || pending.deviceId !== deviceId) {
      throw new ChromeGatewayError("command-unknown", "Command id is unknown for this device", 404);
    }
    clearTimeout(pending.timer);
    this.pending.delete(result.id);
    if (this.inFlight.get(deviceId) === result.id) this.inFlight.delete(deviceId);
    if (result.ok) pending.resolve(result.result);
    else pending.reject(new ChromeGatewayError("device-command-failed", result.error || "Chrome extension command failed", 502));
  }

  private enqueue(deviceId: string, command: GatewayCommand): void {
    const waiter = this.waiters.get(deviceId)?.values().next().value as ((command?: GatewayCommand) => void) | undefined;
    if (waiter) waiter(command);
    else {
      const queue = this.queues.get(deviceId) ?? [];
      queue.push(command);
      this.queues.set(deviceId, queue);
    }
  }

  private removeQueuedCommand(deviceId: string, commandId: string): void {
    const queue = this.queues.get(deviceId);
    if (!queue) return;
    const next = queue.filter((command) => command.id !== commandId);
    if (next.length) this.queues.set(deviceId, next);
    else this.queues.delete(deviceId);
  }

  private rejectDeviceCommands(deviceId: string, error: Error): void {
    this.queues.delete(deviceId);
    this.inFlight.delete(deviceId);
    for (const [id, pending] of this.pending) {
      if (pending.deviceId !== deviceId) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Chrome gateway stopped"));
    }
    this.pending.clear();
    for (const waiters of this.waiters.values()) for (const waiter of waiters) waiter();
    this.waiters.clear();
  }
}

export function getChromeGatewayStorePath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-chrome-gateway", "devices.json");
}

const GATEWAY_KEY = Symbol.for("pi-web:chrome-gateway");

export function getChromeGateway(): ChromeGateway {
  const globals = globalThis as Record<symbol, ChromeGateway | undefined>;
  try {
    return (globals[GATEWAY_KEY] ??= new ChromeGateway());
  } catch (error) {
    throw new ChromeGatewayError("gateway-store-invalid", `Could not load Chrome gateway state: ${errorMessage(error)}`, 500);
  }
}

export function resetChromeGatewayForTests(): void {
  const globals = globalThis as Record<symbol, ChromeGateway | undefined>;
  globals[GATEWAY_KEY]?.close();
  delete globals[GATEWAY_KEY];
}
