import { AfterViewChecked, Component, ElementRef, OnDestroy, ViewChild } from "@angular/core";
import { UpdateService } from "../update.service";
import { megabytes } from "../utils";

type StepState = "pending" | "active" | "done" | "failed";

/**
 * Full-window view while LubaTV updates itself: downloading, installing and reopening, with
 * progress. It stays until LubaTV closes for the installer, or until the viewer closes a failed
 * update. The window buttons stay usable above it.
 */
@Component({
  selector: "app-update-screen",
  templateUrl: "./update-screen.component.html",
  styleUrl: "./update-screen.component.css",
  standalone: false,
})
export class UpdateScreenComponent implements AfterViewChecked, OnDestroy {
  @ViewChild("retry") retry?: ElementRef<HTMLButtonElement>;
  private focusedError = false;

  constructor(
    public updates: UpdateService,
    private host: ElementRef<HTMLElement>,
  ) {
    // Capture phase: the pages' own shortcuts must not act behind the update.
    window.addEventListener("keydown", this.onKeyDown, true);
  }

  ngOnDestroy() {
    window.removeEventListener("keydown", this.onKeyDown, true);
  }

  get failed(): boolean {
    return this.updates.state == "error";
  }

  get title(): string {
    switch (this.updates.state) {
      case "installing":
        return `Installing LubaTV ${this.updates.version}`;
      case "error":
        return "The update didn't finish";
      default:
        return `Updating LubaTV to ${this.updates.version}`;
    }
  }

  get subtitle(): string {
    switch (this.updates.state) {
      case "installing":
        return "LubaTV closes now and reopens by itself in a few seconds.";
      case "error":
        return "LubaTV is unchanged. Try again, or update later from Settings.";
      default:
        return "Getting the new version ready. You can keep this window open.";
    }
  }

  /** "3.4 of 9.8 MB", or what is known so far. */
  get sizeText(): string {
    const { received, total } = this.updates;
    if (!received && !total) return "Starting…";
    if (!total) return `${megabytes(received)} MB`;
    return `${megabytes(received)} of ${megabytes(total)} MB`;
  }

  step(name: "download" | "install" | "restart"): StepState {
    const s = this.updates.state;
    const reached = s == "installing" ? 1 : 0;
    const index = { download: 0, install: 1, restart: 2 }[name];
    if (s == "error") {
      const failedAt = this.updates.failedStep == "install" ? 1 : 0;
      if (index < failedAt) return "done";
      return index == failedAt ? "failed" : "pending";
    }
    if (index < reached) return "done";
    return index == reached ? "active" : "pending";
  }

  /** Moves focus to "Try again" once, when an update fails. */
  ngAfterViewChecked() {
    if (this.failed && !this.focusedError && this.retry) {
      this.focusedError = true;
      this.retry.nativeElement.focus();
    } else if (!this.failed) {
      this.focusedError = false;
    }
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.updates.updating) return;
    const target = event.target instanceof Element ? event.target : null;
    // The window buttons stay usable from the keyboard.
    if (target?.closest(".window-controls")) return;
    if (event.key == "Escape" && this.failed) {
      this.updates.closeUpdate();
    } else if (event.key == "Tab") {
      this.keepFocusInside(event);
      return;
    } else if (target && this.host.nativeElement.contains(target) && ["Enter", " "].includes(event.key)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  /** Tab and Shift+Tab cycle through the screen's buttons, never the page behind it. */
  private keepFocusInside(event: KeyboardEvent) {
    event.stopImmediatePropagation();
    const buttons = [...this.host.nativeElement.querySelectorAll<HTMLElement>("button")];
    if (!buttons.length) {
      event.preventDefault();
      return;
    }
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? (at <= 0 ? buttons.length : at) - 1
      : (at + 1) % buttons.length;
    event.preventDefault();
    buttons[next].focus();
  }
}
