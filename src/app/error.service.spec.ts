import { TestBed } from "@angular/core/testing";
import { NgbModal } from "@ng-bootstrap/ng-bootstrap";
import { ToastrService } from "ngx-toastr";
import { Subject } from "rxjs";
import { ErrorService } from "./error.service";
import { ErrorModalComponent } from "./error-modal/error-modal.component";
import { mockTauri, TEST_PROVIDERS } from "../testing/test-setup";

describe("ErrorService", () => {
  let service: ErrorService;
  let tapped: Subject<void>;
  let toastr: jasmine.SpyObj<ToastrService>;
  let modal: jasmine.SpyObj<NgbModal>;
  let modalInstance: Record<string, unknown>;

  beforeEach(() => {
    mockTauri();
    tapped = new Subject<void>();
    toastr = jasmine.createSpyObj<ToastrService>("ToastrService", ["error", "info", "success"]);
    toastr.error.and.returnValue({ onTap: tapped } as any);
    modalInstance = {};
    modal = jasmine.createSpyObj<NgbModal>("NgbModal", ["open"]);
    modal.open.and.returnValue({ componentInstance: modalInstance } as any);
    spyOn(console, "error");
    TestBed.configureTestingModule({
      providers: [
        ...TEST_PROVIDERS,
        { provide: ToastrService, useValue: toastr },
        { provide: NgbModal, useValue: modal },
      ],
    });
    service = TestBed.inject(ErrorService);
  });

  const notification = () => toastr.error.calls.mostRecent().args[0];

  it("uses the given message, or a generic one", () => {
    service.handleError("boom", "Couldn't refresh the source");
    expect(notification()).toBe("Couldn't refresh the source. Click here for more info");
    service.handleError("boom");
    expect(notification()).toBe("An error occured. Click here for more info");
  });

  it("opens the full error when the notification is clicked", () => {
    service.handleError("line 1\nline 2");
    expect(modal.open).not.toHaveBeenCalled();
    tapped.next();
    expect(modal.open).toHaveBeenCalledOnceWith(ErrorModalComponent, jasmine.any(Object));
    expect(modalInstance["error"]).toBe("line 1\nline 2");
  });

  describe("handlePlayError", () => {
    it("shows the first line of a playback error as the notification", () => {
      service.handlePlayError(
        "The provider refused this channel (HTTP 403)\nTry again later.\n\nmpv output:\n...",
      );
      expect(notification()).toBe(
        "The provider refused this channel (HTTP 403). Click here for more info",
      );
    });

    it("falls back to the generic message for errors that aren't text or are too long", () => {
      service.handlePlayError({ code: 1 });
      expect(notification()).toBe("An error occured. Click here for more info");
      service.handlePlayError("x".repeat(121));
      expect(notification()).toBe("An error occured. Click here for more info");
    });
  });
});
