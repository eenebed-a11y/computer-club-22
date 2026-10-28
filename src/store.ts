import {
  AgentCommand,
  CashRequest,
  Game,
  Pc,
  Payment,
  Session,
} from "./types";

const DEFAULT_PRICE_PER_MINUTE = 1000;
const MIN_MINUTES = 10;
const MAX_MINUTES = 24 * 60;
const STEP_MINUTES = 10;

// Agent buyruqlari tarixi cheksiz o'smasligi uchun saqlanadigan maksimal yozuv soni.
const MAX_COMMAND_HISTORY = 500;

export interface StoreSnapshot {
  version: number;
  pcs: Pc[];
  sessions: Session[];
  payments: Payment[];
  cashRequests: CashRequest[];
  commands: AgentCommand[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function addMinutes(dateIso: string, minutes: number): string {
  return new Date(new Date(dateIso).getTime() + minutes * 60_000).toISOString();
}

function priceForMinutes(minutes: number): number {
  return minutes * DEFAULT_PRICE_PER_MINUTE;
}

export class AppStore {
  private pcs: Pc[] = [];
  private sessions: Session[] = [];
  private payments: Payment[] = [];
  private cashRequests: CashRequest[] = [];
  private commands: AgentCommand[] = [];
  private listeners: Array<() => void> = [];

  private games: Game[] = [
    { gameId: "cs2", name: "Counter-Strike 2" },
    { gameId: "dota2", name: "Dota 2" },
    { gameId: "valorant", name: "Valorant" },
    { gameId: "gta5", name: "GTA V" },
    { gameId: "steam", name: "Steam (boshqa o'yin)" },
  ];

  constructor() {
    const createdAt = nowIso();
    this.pcs = [
      {
        pcId: "PC-01",
        name: "PC 01",
        runtimeStatus: "available",
        kioskCode: "4102",
        lastHeartbeatAt: null,
        agentRegistered: false,
        locked: true,
        allowedGameIds: ["cs2", "dota2", "steam"],
        createdAt,
        updatedAt: createdAt,
      },
      {
        pcId: "PC-02",
        name: "PC 02",
        runtimeStatus: "available",
        kioskCode: "5284",
        lastHeartbeatAt: null,
        agentRegistered: false,
        locked: true,
        allowedGameIds: ["cs2", "dota2", "steam"],
        createdAt,
        updatedAt: createdAt,
      },
      {
        pcId: "PC-03",
        name: "PC 03",
        runtimeStatus: "offline",
        kioskCode: "9031",
        lastHeartbeatAt: null,
        agentRegistered: false,
        locked: true,
        allowedGameIds: ["cs2"],
        createdAt,
        updatedAt: createdAt,
      },
    ];
  }

  /// Holat o'zgarganda chaqiriladi — MongoDB saqlash qatlami shunga ulanadi.
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private notifyChanged(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  toSnapshot(): StoreSnapshot {
    return {
      version: 1,
      pcs: this.pcs,
      sessions: this.sessions,
      payments: this.payments,
      cashRequests: this.cashRequests,
      commands: this.commands,
    };
  }

  loadSnapshot(snapshot: StoreSnapshot): void {
    this.pcs = snapshot.pcs;
    this.sessions = snapshot.sessions;
    this.payments = snapshot.payments;
    this.cashRequests = snapshot.cashRequests;
    this.commands = snapshot.commands;
  }

  getTariffs(): Array<{ minutes: number; price: number }> {
    const tariffs: Array<{ minutes: number; price: number }> = [];

    for (let minutes = MIN_MINUTES; minutes <= MAX_MINUTES; minutes += STEP_MINUTES) {
      tariffs.push({ minutes, price: priceForMinutes(minutes) });
    }

    return tariffs;
  }

  listPcs(): Pc[] {
    return this.pcs;
  }

  getPc(pcId: string): Pc | undefined {
    return this.pcs.find((pc) => pc.pcId === pcId);
  }

  listGames(): Game[] {
    return [...this.games];
  }

  listPcGames(pcId: string): Game[] {
    const pc = this.getPc(pcId);
    if (!pc) {
      return [];
    }

    return this.games.filter((game) => pc.allowedGameIds.includes(game.gameId));
  }

  setPcGames(pcId: string, gameIds: string[]): Pc {
    const pc = this.getPc(pcId);
    if (!pc) {
      throw new Error("PC topilmadi");
    }

    const valid = this.games.map((game) => game.gameId);
    const unknown = gameIds.filter((gameId) => !valid.includes(gameId));

    if (unknown.length > 0) {
      throw new Error(`Noma'lum o'yin: ${unknown.join(", ")}`);
    }

    pc.allowedGameIds = [...new Set(gameIds)];
    pc.updatedAt = nowIso();
    this.notifyChanged();
    return pc;
  }

  setPcLock(pcId: string, locked: boolean): Pc {
    const pc = this.getPc(pcId);
    if (!pc) {
      throw new Error("PC topilmadi");
    }

    pc.locked = locked;
    pc.updatedAt = nowIso();
    this.queueCommand(pcId, "setLock", { locked });
    return pc;
  }

  getGameName(gameId?: string): string | null {
    return this.games.find((game) => game.gameId === gameId)?.name ?? null;
  }

  getPcPage(pcId: string) {
    this.expireSessions();

    const pc = this.getPc(pcId);
    if (!pc) {
      return null;
    }

    const activeSession = this.sessions.find(
      (session) => session.pcId === pcId && session.status === "active",
    );

    return {
      pcId: pc.pcId,
      name: pc.name,
      runtimeStatus: pc.runtimeStatus,
      kioskCodeHint: "Demo rejim uchun serverda seed qilingan kod mavjud",
      activeSession,
      pendingCashRequest: this.getPendingCashRequest(pcId) ?? null,
      tariffs: this.getTariffs(),
    };
  }

  expireSessions() {
    const now = nowIso();

    for (const session of this.sessions) {
      if (session.status !== "active") {
        continue;
      }

      if (!session.endsAt || session.endsAt > now) {
        continue;
      }

      session.status = "ended";
      session.updatedAt = now;
      this.setPcState(session.pcId, "available");
      this.queueCommand(session.pcId, "lock", { reason: "timeout" });
    }
  }

  getKioskState(pcId: string) {
    this.expireSessions();

    const pc = this.getPc(pcId);
    if (!pc) {
      return null;
    }

    const activeSession = this.sessions.find(
      (session) => session.pcId === pcId && session.status === "active",
    );

    const pendingCashRequest = this.getPendingCashRequest(pcId);

    return {
      pcId: pc.pcId,
      name: pc.name,
      runtimeStatus: pc.runtimeStatus,
      locked: pc.locked,
      activeSession: activeSession
        ? { ...activeSession, gameName: this.getGameName(activeSession.gameId) }
        : null,
      pendingCashRequest: pendingCashRequest ?? null,
    };
  }

  /// Kassada naqd/Xolis orqali pul tekshirilgandan keyin admin tomonidan boshlanadi.
  startCashSession(input: {
    pcId: string;
    minutes: number;
    phone?: string;
    gameId?: string;
  }) {
    const pc = this.getPc(input.pcId);
    if (!pc) {
      throw new Error("PC topilmadi");
    }

    if (pc.runtimeStatus === "busy") {
      throw new Error("Bu PC hozir band");
    }

    if (input.gameId && !this.listPcGames(input.pcId).some((game) => game.gameId === input.gameId)) {
      throw new Error("Bu o'yin ushbu PC uchun ruxsat etilmagan");
    }

    const createdAt = nowIso();
    const sessionId = makeId("session");
    const paymentId = makeId("payment");
    const startsAt = createdAt;
    const endsAt = addMinutes(createdAt, input.minutes);

    const session: Session = {
      sessionId,
      pcId: input.pcId,
      userPhone: input.phone,
      gameId: input.gameId,
      status: "active",
      durationMinutes: input.minutes,
      price: priceForMinutes(input.minutes),
      startsAt,
      endsAt,
      createdAt,
      updatedAt: createdAt,
    };

    const payment: Payment = {
      paymentId,
      provider: "cash",
      sessionId,
      status: "paid",
      amount: session.price,
      createdAt,
      updatedAt: createdAt,
    };

    this.sessions.push(session);
    this.payments.push(payment);
    this.setPcState(input.pcId, "busy");
    this.queueCommand(input.pcId, "startSession", {
      sessionId,
      durationMinutes: input.minutes,
      endsAt,
      gameId: input.gameId,
    });

    return {
      session,
      payment,
    };
  }

  startSessionDirect(input: { pcId: string; minutes: number; phone?: string; gameId?: string }) {
    return this.startCashSession(input).session;
  }

  listSessions(): Session[] {
    return [...this.sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  endSession(sessionId: string) {
    const session = this.sessions.find((item) => item.sessionId === sessionId);
    if (!session) {
      throw new Error("Session topilmadi");
    }

    session.status = "ended";
    session.endsAt = nowIso();
    session.updatedAt = nowIso();
    this.setPcState(session.pcId, "available");
    this.queueCommand(session.pcId, "stopSession", { sessionId });
    this.queueCommand(session.pcId, "lock", { reason: "session_ended" });

    return session;
  }

  createCashRequest(input: { pcId: string; requestedMinutes: number; phone?: string }) {
    const pc = this.getPc(input.pcId);
    if (!pc) {
      throw new Error("PC topilmadi");
    }

    if (pc.runtimeStatus === "busy") {
      throw new Error("Bu PC hozir band");
    }

    const createdAt = nowIso();
    const pending = this.cashRequests.find(
      (request) => request.pcId === input.pcId && request.status === "pending",
    );

    // Bir PC uchun bitta ochiq so'rov: mijoz vaqtni o'zgartirsa, o'sha so'rov yangilanadi.
    if (pending) {
      pending.requestedMinutes = input.requestedMinutes;
      pending.phone = input.phone;
      pending.updatedAt = createdAt;
      this.notifyChanged();
      return pending;
    }

    const cashRequest: CashRequest = {
      requestId: makeId("cash"),
      pcId: input.pcId,
      phone: input.phone,
      requestedMinutes: input.requestedMinutes,
      status: "pending",
      createdAt,
      updatedAt: createdAt,
    };

    this.cashRequests.push(cashRequest);
    this.notifyChanged();
    return cashRequest;
  }

  listCashRequests(): CashRequest[] {
    return [...this.cashRequests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getPendingCashRequest(pcId: string): CashRequest | null {
    return (
      this.cashRequests.find(
        (request) => request.pcId === pcId && request.status === "pending",
      ) ?? null
    );
  }

  approveCashRequest(requestId: string, adminId: string, gameId?: string) {
    const request = this.cashRequests.find((item) => item.requestId === requestId);
    if (!request) {
      throw new Error("Cash request topilmadi");
    }

    if (request.status !== "pending") {
      throw new Error("Faqat pending so'rov tasdiqlanadi");
    }

    const result = this.startCashSession({
      pcId: request.pcId,
      minutes: request.requestedMinutes,
      phone: request.phone,
      gameId,
    });

    request.status = "approved";
    request.approvedByAdminId = adminId;
    request.updatedAt = nowIso();
    this.notifyChanged();

    return result;
  }

  rejectCashRequest(requestId: string) {
    const request = this.cashRequests.find((item) => item.requestId === requestId);
    if (!request) {
      throw new Error("Cash request topilmadi");
    }

    if (request.status !== "pending") {
      throw new Error("Faqat pending so'rov rad etiladi");
    }

    request.status = "rejected";
    request.updatedAt = nowIso();
    this.notifyChanged();
    return request;
  }

  registerAgent(pcId: string) {
    const pc = this.getPc(pcId);
    if (!pc) {
      throw new Error("PC topilmadi");
    }

    pc.agentRegistered = true;
    pc.lastHeartbeatAt = nowIso();
    pc.updatedAt = nowIso();

    if (pc.runtimeStatus === "offline") {
      pc.runtimeStatus = "available";
    }

    this.notifyChanged();
    return pc;
  }

  heartbeat(pcId: string) {
    const pc = this.getPc(pcId);
    if (!pc) {
      throw new Error("PC topilmadi");
    }

    // Heartbeat bir necha soniyada bir keladi — ataylab notifyChanged chaqirilmaydi,
    // aks holda MongoDB'ga behuda yozuvlar ko'p bo'ladi. Agent qayta ishga tushsa
    // o'zi register qilib holatni tiklaydi.
    pc.lastHeartbeatAt = nowIso();
    pc.updatedAt = nowIso();
    return pc;
  }

  listCommandsForPc(pcId: string): AgentCommand[] {
    return this.commands.filter((command) => command.pcId === pcId);
  }

  getPendingCommand(pcId: string): AgentCommand | null {
    return (
      this.commands.find(
        (command) => command.pcId === pcId && command.status === "pending",
      ) ?? null
    );
  }

  acknowledgeCommand(commandId: string) {
    const command = this.commands.find((item) => item.commandId === commandId);
    if (!command) {
      throw new Error("Command topilmadi");
    }

    command.status = "delivered";
    command.deliveredAt = nowIso();
    this.notifyChanged();
    return command;
  }

  private queueCommand(
    pcId: string,
    type: AgentCommand["type"],
    payload?: Record<string, unknown>,
  ) {
    const command: AgentCommand = {
      commandId: makeId("cmd"),
      pcId,
      type,
      payload,
      status: "pending",
      createdAt: nowIso(),
      deliveredAt: null,
    };

    this.commands.push(command);

    if (this.commands.length > MAX_COMMAND_HISTORY) {
      this.commands.splice(0, this.commands.length - MAX_COMMAND_HISTORY);
    }

    this.notifyChanged();
    return command;
  }

  private setPcState(pcId: string, runtimeStatus: Pc["runtimeStatus"]) {
    const pc = this.getPc(pcId);
    if (!pc) {
      throw new Error("PC topilmadi");
    }

    pc.runtimeStatus = runtimeStatus;
    pc.updatedAt = nowIso();
    return pc;
  }
}

export const store = new AppStore();
