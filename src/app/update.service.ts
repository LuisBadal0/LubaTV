import { Injectable, NgZone } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";
import { check, DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { hasChanges } from "./release-notes";

/** How long "Installing" stays on screen before LubaTV closes for the installer. */
export const INSTALL_NOTICE_MS = 1500;

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
  /** What's new in that version: its CHANGELOG.md section, from latest.json. */
  notes?: string;
  /** Download progress, 0 to 100. */
  progress = 0;
  /** Bytes downloaded so far, and the size of the update when the server says. */
  received = 0;
  total = 0;
  /** True from "Update" until LubaTV closes, or until the viewer closes a failed update. */
  updating = false;
  /** Which step a failed update stopped at. */
  failedStep?: "download" | "install";
  error?: string;
  checkedAt?: Date;
  /** The corner prompt is for updates found by the start-up check; Settings shows its own. */
  prompt = false;
  /** Hides the start-up prompt for this session after "Later". */
  dismissed = false;
  readonly supported = navigator.userAgent.includes("Windows");
  /** Tests shorten the pause on "Installing". */
  installNoticeMs = INSTALL_NOTICE_MS;
  private update?: Update;
  /** The update finished downloading, so trying again only needs to install it. */
  private downloaded = false;

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
        this.downloaded = false;
        this.version = update.version;
        // Releases before 1.5.0 only link to GitHub; show notes that list changes.
        this.notes = hasChanges(update.body) ? update.body : undefined;
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

  /**
   * Downloads the update, shows that it is installing, then hands over to the installer. On
   * Windows the installer runs without a window of its own (installMode "quiet" in
   * tauri.conf.json): it closes LubaTV, installs and opens the new version, so the full-screen
   * update view and a notification are what the viewer sees.
   */
  async install(): Promise<void> {
    if (!this.update || this.busy) return;
    const update = this.update;
    this.updating = true;
    this.error = undefined;
    this.failedStep = undefined;
    if (!this.downloaded) {
      this.state = "downloading";
      this.progress = 0;
      this.received = 0;
      this.total = 0;
      try {
        await update.download((event) => this.zone.run(() => this.onDownload(event)));
        this.downloaded = true;
        this.progress = 100;
      } catch (e) {
        this.fail("download", e);
        return;
      }
    }
    this.state = "installing";
    try {
      await new Promise((resolve) => setTimeout(resolve, this.installNoticeMs));
      // The updater ends LubaTV without its usual clean-up, which would leave mpv playing.
      await invoke("close_players").catch((e) => console.error(e));
      await this.notifyRestart();
      await update.install();
      // Windows exits inside install(); elsewhere restart into the new version.
      await relaunch();
    } catch (e) {
      this.fail("install", e);
    }
  }

  /** After a failed update: back to the app, with the update still offered. */
  closeUpdate() {
    if (this.state == "downloading" || this.state == "installing") return;
    this.updating = false;
    this.error = undefined;
    this.failedStep = undefined;
    this.state = this.update ? "available" : "idle";
  }

  private onDownload(event: DownloadEvent) {
    switch (event.event) {
      case "Started":
        this.total = event.data.contentLength ?? 0;
        break;
      case "Progress":
        this.received += event.data.chunkLength;
        this.progress = this.total
          ? Math.min(100, Math.round((this.received / this.total) * 100))
          : 0;
        break;
      case "Finished":
        this.progress = 100;
        break;
    }
  }

  private fail(step: "download" | "install", e: unknown) {
    console.error(e);
    this.failedStep = step;
    this.error = String(e);
    this.state = "error";
  }

  /** Tells the viewer, while LubaTV is closed, that it is coming back. */
  private async notifyRestart() {
    try {
      if (!(await isPermissionGranted())) return;
      sendNotification({
        title: `Installing LubaTV ${this.version}`,
        body: "LubaTV reopens by itself in a few seconds.",
      });
    } catch (e) {
      // A missing notification must never stop the update.
      console.error(e);
    }
  }
}
