import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Minimize, maximize and close, drawn by LubaTV because the window has no system title bar
 * (decorations are off in tauri.conf.json). Placed at the end of each page's header row.
 */
@Component({
  selector: "app-window-controls",
  templateUrl: "./window-controls.component.html",
  styleUrl: "./window-controls.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WindowControlsComponent implements OnInit, OnDestroy {
  maximized = false;
  private unlisten?: () => void;

  constructor(private cdr: ChangeDetectorRef) {}

  async ngOnInit() {
    try {
      const window = getCurrentWindow();
      await this.updateMaximized();
      // Maximizing, restoring and snapping all resize the window.
      this.unlisten = await window.onResized(() => this.updateMaximized());
    } catch (e) {
      console.error(e);
    }
  }

  ngOnDestroy() {
    this.unlisten?.();
  }

  minimize() {
    getCurrentWindow().minimize().catch(console.error);
  }

  toggleMaximize() {
    getCurrentWindow().toggleMaximize().catch(console.error);
  }

  /** Same as the system close button: hides to the tray when the tray icon is on. */
  close() {
    getCurrentWindow().close().catch(console.error);
  }

  private async updateMaximized() {
    const maximized = await getCurrentWindow().isMaximized();
    if (maximized !== this.maximized) {
      this.maximized = maximized;
      this.cdr.markForCheck();
    }
  }
}
