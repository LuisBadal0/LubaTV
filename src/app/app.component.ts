import { Component, HostListener, isDevMode } from "@angular/core";
import { DownloadService } from "./download.service";
import { UpdateService } from "./update.service";

@Component({
  selector: "app-root",
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {
  title = "lubatv";

  constructor(
    private download: DownloadService,
    updates: UpdateService,
  ) {
    // Look for a newer release shortly after start-up, once the library has loaded.
    // Development builds skip it; Settings > About can still check by hand.
    if (!isDevMode()) setTimeout(() => updates.check(true), 8000);
  }

  @HostListener("document:contextmenu", ["$event"])
  onRightClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (this.isInsideMenuTrigger(target)) {
      return;
    }
    event.preventDefault();
  }

  private isInsideMenuTrigger(element: HTMLElement): boolean {
    return !!element.closest("[mat-menu-trigger-for], [matMenuTriggerFor]");
  }

  showDownloadManager() {
    return this.download.Downloads.size > 0;
  }

  /**
   * Where to show the window buttons above an open dialog, which otherwise covers the
   * ones in the page header (the window has no system title bar to fall back on).
   */
  controlsOverDialog?: { top: number; left: number };

  ngOnInit() {
    new MutationObserver(() => this.placeControlsOverDialog()).observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  @HostListener("window:resize")
  placeControlsOverDialog() {
    const dialogOpen = document.body.classList.contains("modal-open");
    const inPage = document.querySelector("app-window-controls:not(.over-dialog)");
    if (!dialogOpen || !inPage) {
      this.controlsOverDialog = undefined;
      return;
    }
    const rect = inPage.getBoundingClientRect();
    // From the left: the page's scrollbar would shift a position taken from the right.
    this.controlsOverDialog = { top: rect.top, left: rect.left };
  }
}
