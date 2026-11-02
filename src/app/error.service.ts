import { Injectable } from "@angular/core";
import { NgbModal } from "@ng-bootstrap/ng-bootstrap";
import { ToastrService } from "ngx-toastr";
import { ErrorModalComponent } from "./error-modal/error-modal.component";
import { take } from "rxjs";
import { publicDir } from "@tauri-apps/api/path";

@Injectable({
  providedIn: "root",
})
export class ErrorService {
  constructor(
    private toastr: ToastrService,
    private modal: NgbModal,
  ) {}

  public handleError(e: any, message?: string) {
    let error = e as string;
    console.error(error);
    this.toastr
      .error(
        message
          ? message + ". Click here for more info"
          : "An error occured. Click here for more info",
      )
      .onTap.pipe(take(1))
      .subscribe(() => this.showError(error));
  }

  /**
   * For errors from playing a channel. Their first line is a readable summary
   * ("The provider refused this channel (HTTP 403)"), shown in the notification;
   * the rest (what to try, and mpv's output) is in the details.
   */
  public handlePlayError(e: any) {
    const summary = typeof e === "string" ? e.split("\n", 1)[0].trim() : "";
    this.handleError(e, summary && summary.length <= 120 ? summary : undefined);
  }

  private showError(error: string) {
    const modalRef = this.modal.open(ErrorModalComponent, { backdrop: "static", size: "xl" });
    modalRef.componentInstance.name = "ErrorModal";
    modalRef.componentInstance.error = error;
  }

  public info(message: string) {
    this.toastr.info(message);
  }

  public success(message: string) {
    this.toastr.success(message);
  }
}
