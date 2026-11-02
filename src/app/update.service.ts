import { Injectable, NgZone } from "@angular/core";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "up-to-date"
  | "error"
  | "unsupported";

/**
 * Checks GitHub releases for a newer signed build and installs it (see plugins.updater in
 * tauri.conf.json). Only the Windows installers can update themselves; Linux packages are
 * updated by the package manager.
 */
@Injectable({
  providedIn: "root",
})
export class UpdateService {
  state: UpdateState = "idle";
  /** The newer version, once found. */
  version?: string;
  /** Download progress, 0 to 100. */
  progress = 0;
  error?: string;
  checkedAt?: Date;
  /** The corner prompt is for updates found by the start-up check; Settings shows its own. */
  prompt = false;
  /** Hides the start-up prompt for this session after "Later". */
  dismissed = false;
  readonly supported = navigator.userAgent.includes("Windows");
  private update?: Update;

  constructor(private zone: NgZone) {}

  get busy(): boolean {
    return this.state == "checking" || this.state == "downloading" || this.state == "installing";
  }

  /**
   * Looks for a newer release. Quiet on failure; Settings shows the result.
   * @param fromStartup offer the update in the corner prompt.
   */
  async check(fromStartup = false): Promise<void> {
    if (!this.supported) {
      this.state = "unsupported";
      return;
    }
    if (this.busy) return;
    this.state = "checking";
    this.error = undefined;
    try {
      const update = await check();
      this.checkedAt = new Date();
      if (update) {
        this.update = update;
        this.version = update.version;
        this.prompt = fromStartup;
        this.state = "available";
      } else {
        this.state = "up-to-date";
      }
    } catch (e) {
      console.error(e);
      this.error = String(e);
      this.state = "error";
    }
  }

  /** Downloads and installs the update, then restarts LubaTV. */
  async install(): Promise<void> {
    if (!this.update || this.busy) return;
    this.state = "downloading";
    this.progress = 0;
    let total = 0;
    let received = 0;
    try {
      await this.update.downloadAndInstall((event) => {
        this.zone.run(() => {
          switch (event.event) {
            case "Started":
              total = event.data.contentLength ?? 0;
              break;
            case "Progress":
              received += event.data.chunkLength;
              this.progress = total ? Math.min(100, Math.round((received / total) * 100)) : 0;
              break;
            case "Finished":
              this.progress = 100;
              this.state = "installing";
              break;
          }
        });
      });
      // On Windows the installer closes LubaTV itself; elsewhere restart into the new version.
      await relaunch();
    } catch (e) {
      console.error(e);
      this.error = String(e);
      this.state = "error";
    }
  }
}
