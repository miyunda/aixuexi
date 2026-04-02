import * as fs from "fs";
import * as path from "path";

export interface IHistoryRecord { url: string; timestamp: number; }
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";

    const keepParams = ["id", "art_id", "item_id"];
    const filtered = new URLSearchParams();
    for (const key of keepParams) {
      const value = url.searchParams.get(key);
      if (value) filtered.set(key, value);
    }
    url.search = filtered.toString() ? `?${filtered.toString()}` : "";
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

export class HistoryManager {
  private records: IHistoryRecord[] = [];
  
  constructor(private filepath: string) {
    if (!fs.existsSync(path.dirname(this.filepath))) {
        fs.mkdirSync(path.dirname(this.filepath), { recursive: true });
    }
    this.load();
  }

  private load() {
    if (fs.existsSync(this.filepath)) {
      this.records = JSON.parse(fs.readFileSync(this.filepath, 'utf8'));
    }
    this.pruneExpired();
  }

  private pruneExpired() {
    const cutoff = Date.now() - RETENTION_MS;
    this.records = this.records
      .map(record => ({ ...record, url: normalizeUrl(record.url) }))
      .filter(record => record.url && record.timestamp >= cutoff);
  }

  public save() {
    this.pruneExpired();
    fs.writeFileSync(this.filepath, JSON.stringify(this.records, null, 2));
  }

  public addUrl(url: string) {
    const normalizedUrl = normalizeUrl(url);
    if (!this.hasUrl(normalizedUrl)) {
      this.records.push({ url: normalizedUrl, timestamp: Date.now() });
      this.save();
    }
  }

  public hasUrl(url: string): boolean {
    this.pruneExpired();
    const normalizedUrl = normalizeUrl(url);
    return this.records.some(r => r.url === normalizedUrl);
  }
}
