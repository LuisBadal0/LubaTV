import { Injectable, NgZone } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** What LubaTV has to copy or download to have current player files (see player_files.rs). */
interface PlayerFilesStatus {
  download: string[];
  download_size: number;
  copy: string[];
}

export type PlayerFilesState = "idle" | "syncing" | "done" | "error";

/**
 * Keeps mpv, ffmpeg and yt-dlp current on Windows. Updates don't include them, so after
 * an update LubaTV gets only the ones that changed. Runs at start-up.
 */
@Injectable({
  providedIn: "root",
})
export class PlayerFilesService {
  state: PlayerFilesState = "idle";
  /** Bytes downloaded so far, and in total (0 when everything is copied locally). */
  downloaded = 0;
  total = 0;
  error?: string;

  constructor(private zone: NgZone) {}

  get progress(): number {
    return this.total ? Math.min(100, Math.round((this.downloaded / this.total) * 100)) : 0;
  }

  async ensure(): Promise<void> {
    if (!navigator.userAgent.includes("Windows") || this.state == "syncing") return;
    try {
      const status = await invoke<PlayerFilesStatus | null>("player_files_status");
      if (!status || (!status.download.length && !status.copy.length)) return;
      await this.sync(status.download_size);
    } catch (e) {
      this.fail(e);
    }
  }

  private async sync(total: number) {
    this.state = "syncing";
    this.error = undefined;
    this.downloaded = 0;
    this.total = total;
    const unlisten = await listen<{ downloaded: number; total: number }>("player_files_progress", (e) =>
      this.zone.run(() => (this.downloaded = e.payload.downloaded)),
    );
    try {
      await invoke("sync_player_files");
      this.state = "done";
      setTimeout(() => {
        if (this.state == "done") this.state = "idle";
      }, 5000);
    } catch (e) {
      this.fail(e);
    } finally {
      unlisten();
    }
  }

  private fail(e: unknown) {
    console.error(e);
    this.state = "error";
    // The first line of the backend error is the readable part.
    this.error = String(e).split("\n", 1)[0];
  }

  dismiss() {
    this.state = "idle";
  }
}
