import * as fs from "fs";
import * as os from "os";
import * as path from "path";

type ConsoleMethod = "log" | "error" | "warn" | "info";
type LogLevel = "INFO" | "ERROR" | "WARN";

export interface LoggerOptions {
  retentionDays: number;
  logsDir?: string;
  mirrorToConsole?: boolean;
}

export class RunLogger {
  private readonly logsDir: string;
  private readonly retentionDays: number;
  private readonly mirrorToConsole: boolean;
  private readonly lines: string[] = [];
  private readonly originalConsole: Record<ConsoleMethod, (...args: unknown[]) => void>;
  private readonly startedAt = new Date();
  private readonly runId: string;
  private readonly levelCounts: Record<LogLevel, number> = {
    INFO: 0,
    WARN: 0,
    ERROR: 0,
  };
  private active = false;

  constructor(options: LoggerOptions) {
    this.logsDir = options.logsDir || "./logs";
    this.retentionDays = options.retentionDays;
    this.mirrorToConsole = options.mirrorToConsole ?? true;
    this.runId = this.formatTimestamp(this.startedAt);
    this.originalConsole = {
      log: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      info: console.info.bind(console),
    };
  }

  public start() {
    if (this.active) return;
    this.active = true;
    this.lines.push(...this.buildHeader());

    for (const method of Object.keys(this.originalConsole) as ConsoleMethod[]) {
      console[method] = (...args: unknown[]) => {
        if (this.mirrorToConsole) {
          this.originalConsole[method](...args);
        }
        this.capture(method, args);
      };
    }
  }

  public flush() {
    if (!this.active) return;
    this.restoreConsole();

    if (this.retentionDays <= 0) {
      return;
    }

    const finishedAt = new Date();
    this.lines.push(...this.buildFooter(finishedAt));

    this.pruneOldLogs(this.logsDir);

    const dayDir = path.join(this.logsDir, this.formatDate(this.startedAt));
    if (!fs.existsSync(dayDir)) {
      fs.mkdirSync(dayDir, { recursive: true });
    }

    const filename = `run-${this.formatTime(this.startedAt)}.log`;
    const filepath = path.join(dayDir, filename);
    const tempPath = `${filepath}.tmp`;
    fs.writeFileSync(tempPath, `${this.lines.join("\n")}\n`);
    fs.renameSync(tempPath, filepath);
  }

  private restoreConsole() {
    for (const method of Object.keys(this.originalConsole) as ConsoleMethod[]) {
      console[method] = this.originalConsole[method];
    }
    this.active = false;
  }

  private capture(method: ConsoleMethod, args: unknown[]) {
    const timestamp = this.formatDateTime(new Date());
    const level = this.mapMethodToLevel(method);
    this.levelCounts[level] += 1;
    const rendered = args.map((arg) => this.renderArg(arg)).join(" ");
    this.lines.push(`[${timestamp}] [${level}] ${rendered}`);
  }

  private buildHeader(): string[] {
    return [
      "==== AiXuexi Run Log ====",
      `run_id: ${this.runId}`,
      `started_at: ${this.formatDateTime(this.startedAt)}`,
      `host: ${os.hostname()}`,
      `pid: ${process.pid}`,
      `cwd: ${process.cwd()}`,
      `platform: ${process.platform}`,
      `node_env: ${process.env.NODE_ENV || "unset"}`,
      "------------------------",
    ];
  }

  private buildFooter(finishedAt: Date): string[] {
    const durationMs = finishedAt.getTime() - this.startedAt.getTime();
    return [
      "------------------------",
      `finished_at: ${this.formatDateTime(finishedAt)}`,
      `duration_ms: ${durationMs}`,
      `info_count: ${this.levelCounts.INFO}`,
      `warn_count: ${this.levelCounts.WARN}`,
      `error_count: ${this.levelCounts.ERROR}`,
      "==== End Of Run Log ====",
    ];
  }

  private mapMethodToLevel(method: ConsoleMethod): LogLevel {
    if (method === "error") return "ERROR";
    if (method === "warn") return "WARN";
    return "INFO";
  }

  private renderArg(arg: unknown): string {
    if (typeof arg === "string") return arg;
    if (arg instanceof Error) return arg.stack || arg.message;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }

  private pruneOldLogs(rootDir: string) {
    if (!fs.existsSync(rootDir)) return;

    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      const filepath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        this.pruneOldLogs(filepath);
        if (fs.existsSync(filepath) && fs.readdirSync(filepath).length === 0) {
          fs.rmdirSync(filepath);
        }
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".log")) continue;
      const stat = fs.statSync(filepath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filepath);
      }
    }
  }

  private formatDate(date: Date): string {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private formatTime(date: Date): string {
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const second = String(date.getSeconds()).padStart(2, "0");
    return `${hour}${minute}${second}`;
  }

  private formatTimestamp(date: Date): string {
    return `${this.formatDate(date)}-${this.formatTime(date)}`;
  }

  private formatDateTime(date: Date): string {
    return `${this.formatDate(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
  }
}
