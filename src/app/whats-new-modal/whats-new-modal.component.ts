import { Component, OnInit } from "@angular/core";
import { NgbActiveModal } from "@ng-bootstrap/ng-bootstrap";
import { MemoryService } from "../memory.service";
import { changelogSection } from "../release-notes";

/** CHANGELOG.md ships with the app (see angular.json), so the notes match the version. */
export const CHANGELOG_URL = "CHANGELOG.md";

@Component({
  selector: "app-whats-new-modal",
  templateUrl: "./whats-new-modal.component.html",
  styleUrl: "./whats-new-modal.component.css",
  standalone: false,
})
export class WhatsNewModalComponent implements OnInit {
  constructor(
    private activeModal: NgbActiveModal,
    public memory: MemoryService,
  ) {}
  /** This version's CHANGELOG.md section. */
  notes?: string;
  loaded = false;

  async ngOnInit() {
    const version = this.memory.AppVersion;
    try {
      const response = await fetch(CHANGELOG_URL);
      if (response.ok && version) this.notes = changelogSection(await response.text(), version);
    } catch (e) {
      console.error(e);
    }
    this.loaded = true;
  }

  releaseUrl(): string {
    return `https://github.com/LuisBadal0/LubaTV/releases/tag/v${this.memory.AppVersion ?? ""}`;
  }

  close() {
    this.memory.updateVersion();
    this.activeModal.close("Cross click");
  }
}
