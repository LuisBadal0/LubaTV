import { Component, HostListener, isDevMode } from "@angular/core";
import { DownloadService } from "./download.service";
import { UpdateService } from "./update.service";
import { PlayerFilesService } from "./player-files.service";

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
    player: PlayerFilesService,
  ) {
    // Updates don't include the player files; get the ones that changed.
    player.ensure();
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
}
