import { ComponentFixture, TestBed } from "@angular/core/testing";
import { UpdateScreenComponent } from "./update-screen.component";
import { UpdateService } from "../update.service";
import { mockTauri, TEST_IMPORTS, TEST_PROVIDERS, TEST_SCHEMAS } from "../../testing/test-setup";

describe("UpdateScreenComponent", () => {
  let fixture: ComponentFixture<UpdateScreenComponent>;
  let updates: UpdateService;
  let page: HTMLElement;

  beforeEach(async () => {
    mockTauri();
    await TestBed.configureTestingModule({
      declarations: [UpdateScreenComponent],
      imports: TEST_IMPORTS,
      providers: TEST_PROVIDERS,
      schemas: TEST_SCHEMAS,
    }).compileComponents();
    updates = TestBed.inject(UpdateService);
    updates.version = "9.9.9";
    fixture = TestBed.createComponent(UpdateScreenComponent);
    page = fixture.nativeElement;
  });

  function show(state: UpdateService["state"], progress = 0, received = 0, total = 0) {
    Object.assign(updates, { updating: true, state, progress, received, total });
    fixture.detectChanges();
  }

  const steps = () =>
    [...page.querySelectorAll(".steps li")].map((li) => li.className.trim());

  it("stays hidden until an update starts", () => {
    fixture.detectChanges();
    expect(page.querySelector(".update-screen")).toBeNull();
  });

  it("shows the download with its progress and size", () => {
    show("downloading", 40, 4194304, 10485760);
    expect(page.querySelector("h1")?.textContent).toContain("Updating LubaTV to 9.9.9");
    expect(steps()).toEqual(["active", "pending", "pending"]);
    expect(page.querySelector<HTMLElement>(".progress i")?.style.width).toBe("40%");
    expect(page.querySelector(".meta")?.textContent).toContain("40%");
    expect(page.querySelector(".meta")?.textContent).toContain("4.0 of 10 MB");
    expect(page.querySelector(".logo")?.classList).toContain("working");
  });

  it("sweeps the bar when the size is unknown", () => {
    show("downloading", 0, 2097152, 0);
    expect(page.querySelector(".progress i")?.classList).toContain("indeterminate");
    expect(page.querySelector(".meta")?.textContent).toContain("2.0 MB");
  });

  it("says LubaTV closes and reopens while installing", () => {
    show("installing", 100, 10485760, 10485760);
    expect(page.querySelector("h1")?.textContent).toContain("Installing LubaTV 9.9.9");
    expect(page.querySelector(".subtitle")?.textContent).toContain("reopens by itself");
    expect(steps()).toEqual(["done", "active", "pending"]);
    expect(page.querySelector(".progress i")?.classList).toContain("indeterminate");
  });

  it("marks the failed step and offers to try again or later", () => {
    updates.error = "connection reset";
    updates.failedStep = "download";
    show("error", 40);
    expect(steps()).toEqual(["failed", "pending", "pending"]);
    expect(page.querySelector(".error")?.textContent).toContain("connection reset");
    fixture.detectChanges();
    expect(document.activeElement?.textContent).toContain("Try again");

    const install = spyOn(updates, "install");
    page.querySelector<HTMLButtonElement>(".actions .btn-primary")!.click();
    expect(install).toHaveBeenCalled();
  });

  it("marks the install step when that is where it failed", () => {
    updates.failedStep = "install";
    show("error", 100);
    expect(steps()).toEqual(["done", "failed", "pending"]);
  });

  it("keeps Tab on its own buttons after a failure", () => {
    updates.failedStep = "download";
    show("error", 10);
    fixture.detectChanges();
    const [retry, later] = page.querySelectorAll<HTMLButtonElement>(".actions button");
    expect(document.activeElement).toBe(retry);

    const tab = (shiftKey = false) =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true }),
      );
    tab();
    expect(document.activeElement).toBe(later);
    tab();
    expect(document.activeElement).toBe(retry);
    tab(true);
    expect(document.activeElement).toBe(later);
  });

  it("leaves keys to the window buttons", () => {
    show("downloading", 10);
    const controls = document.createElement("div");
    controls.className = "window-controls";
    const button = document.createElement("button");
    controls.appendChild(button);
    document.body.appendChild(controls);
    const pressed = jasmine.createSpy("window button key");
    button.addEventListener("keydown", pressed);

    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    controls.remove();
    expect(pressed).toHaveBeenCalled();
  });

  it("keeps the pages' shortcuts from acting behind it", () => {
    show("downloading", 10);
    const behind = jasmine.createSpy("page shortcut");
    document.addEventListener("keydown", behind);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    document.removeEventListener("keydown", behind);
    expect(behind).not.toHaveBeenCalled();
  });

  it("closes a failed update with Escape, but not one that is still running", () => {
    show("downloading", 10);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(updates.updating).toBeTrue();

    show("error", 10);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(updates.updating).toBeFalse();
  });
});
