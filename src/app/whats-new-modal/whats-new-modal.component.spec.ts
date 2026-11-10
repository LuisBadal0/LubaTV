import { TestBed } from "@angular/core/testing";
import { WhatsNewModalComponent } from "./whats-new-modal.component";
import { ReleaseNotesComponent } from "../release-notes/release-notes.component";
import { MemoryService } from "../memory.service";
import { mockTauri, TEST_IMPORTS, TEST_PROVIDERS, TEST_SCHEMAS } from "../../testing/test-setup";

const CHANGELOG = `# Changelog

## [Unreleased]

## [2.0.0] - 2026-12-01

### Added

- **Made-up** feature for the test.
`;

describe("WhatsNewModalComponent", () => {
  beforeEach(async () => {
    mockTauri();
    await TestBed.configureTestingModule({
      declarations: [WhatsNewModalComponent, ReleaseNotesComponent],
      imports: TEST_IMPORTS,
      providers: TEST_PROVIDERS,
      schemas: TEST_SCHEMAS,
    }).compileComponents();
  });

  async function render(version: string, response: () => Response) {
    spyOn(window, "fetch").and.callFake(async () => response());
    TestBed.inject(MemoryService).AppVersion = version;
    const fixture = TestBed.createComponent(WhatsNewModalComponent);
    fixture.detectChanges();
    // Reading the response body isn't a task Angular tracks, so wait for the window itself.
    for (let i = 0; i < 100 && !fixture.componentInstance.loaded; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it("shows the running version's section of the bundled changelog", async () => {
    const page = await render("2.0.0", () => new Response(CHANGELOG));
    expect(window.fetch).toHaveBeenCalledWith("CHANGELOG.md");
    expect(page.querySelector("h3")?.textContent).toContain("Added");
    expect(page.querySelector("li b")?.textContent).toBe("Made-up");
  });

  it("links to the release page when the changelog has no section", async () => {
    const page = await render("9.9.9", () => new Response(CHANGELOG));
    const link = page.querySelector<HTMLAnchorElement>(".modal-body a");
    expect(link?.href).toBe("https://github.com/LuisBadal0/LubaTV/releases/tag/v9.9.9");
  });

  it("links to the release page when the changelog can't be read", async () => {
    const page = await render("2.0.0", () => new Response("", { status: 404 }));
    expect(page.querySelector(".modal-body a")).not.toBeNull();
  });
});
