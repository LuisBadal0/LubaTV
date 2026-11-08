import { Component } from "@angular/core";
import { NgbActiveModal } from "@ng-bootstrap/ng-bootstrap";
import { invoke } from "@tauri-apps/api/core";
import { ErrorService } from "../error.service";
import { LegacyData } from "../models/legacyData";

/** Asked once after the first start: keep or delete the folders of the app LubaTV was forked from. */
@Component({
    selector: "app-legacy-data-modal",
    templateUrl: "./legacy-data-modal.component.html",
    styleUrl: "./legacy-data-modal.component.css",
    standalone: false
})
export class LegacyDataModalComponent {
  legacy?: LegacyData;
  name = "LegacyDataModal";
  busy = false;

  constructor(
    public activeModal: NgbActiveModal,
    private error: ErrorService,
  ) {}

  get sizeText(): string {
    const mb = (this.legacy?.size_bytes ?? 0) / (1024 * 1024);
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(mb, 0.1).toFixed(1)} MB`;
  }

  async choose(remove: boolean) {
    this.busy = true;
    try {
      await invoke("resolve_legacy_data", { delete: remove });
      if (remove) this.error.success("Deleted the old app's data");
      this.activeModal.close(remove ? "deleted" : "kept");
    } catch (e) {
      // Nothing is recorded on failure, so LubaTV asks again next time.
      this.error.handleError(e);
      this.activeModal.close("failed");
    }
    this.busy = false;
  }
}
