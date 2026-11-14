import { TestBed } from "@angular/core/testing";
import { SpotlightComponent } from "./spotlight.component";
import { Channel } from "../models/channel";
import { MediaType } from "../models/mediaType";
import { mockTauri, TEST_IMPORTS, TEST_PROVIDERS, TEST_SCHEMAS } from "../../testing/test-setup";

describe("SpotlightComponent", () => {
  const start = Math.floor(Date.now() / 1000) - 600;
  const guide = [
    { epg_id: "1", title: "Made-up match", start_timestamp: start, now_playing: true },
    { epg_id: "2", title: "Made-up studio", start_timestamp: start + 1800, now_playing: false },
  ];

  async function render(channel: Channel, hasGuide = false, answers: Record<string, unknown> = {}) {
    mockTauri(answers);
    await TestBed.configureTestingModule({
      declarations: [SpotlightComponent],
      imports: TEST_IMPORTS,
      providers: TEST_PROVIDERS,
      schemas: TEST_SCHEMAS,
    }).compileComponents();
    const fixture = TestBed.createComponent(SpotlightComponent);
    fixture.componentRef.setInput("channel", channel);
    fixture.componentRef.setInput("hasGuide", hasGuide);
    fixture.componentRef.setInput("lastWatched", start);
    fixture.detectChanges();
    await fixture.whenStable();
    // The fake backend answers after a turn of the event loop.
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();
    return fixture;
  }

  it("shows a live channel without its country prefix, and what is on", async () => {
    const fixture = await render(
      { id: 1, name: "PT: Made-up Sport", media_type: MediaType.livestream, source_id: 1 },
      true,
      { get_epg: guide },
    );
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector("h2")?.textContent).toBe("Made-up Sport");
    expect(page.querySelector(".cc")?.textContent).toBe("PT");
    expect(page.querySelector(".live")).not.toBeNull();
    expect(page.querySelector(".now")?.textContent).toContain("Made-up match");
    expect(page.querySelector(".now")?.textContent).toContain("then Made-up studio");
    const done = Number(page.querySelector(".bar")?.getAttribute("aria-valuenow"));
    expect(done).toBeGreaterThan(30);
    expect(done).toBeLessThan(37);
    expect(page.querySelector(".primary")?.textContent).toContain("Watch");
  });

  it("offers a movie to play, with no guide", async () => {
    const fixture = await render({ id: 2, name: "Made-up Movie", media_type: MediaType.movie, source_id: 1 });
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector(".spotlight")?.classList).toContain("poster");
    expect(page.querySelector(".live")).toBeNull();
    expect(page.querySelector(".now")).toBeNull();
    expect(page.querySelector(".primary")?.textContent).toContain("Play");
    expect(page.querySelector(".kicker")?.textContent).toContain("Movie · watched 10 minutes ago");
    expect(page.textContent).not.toContain("TV guide");
  });

  it("asks home to start the item", async () => {
    const fixture = await render({ id: 2, name: "Made-up Movie", media_type: MediaType.movie, source_id: 1 });
    const played = jasmine.createSpy("play");
    fixture.componentInstance.play.subscribe(played);
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(".primary")!.click();
    expect(played).toHaveBeenCalled();
  });

  it("toggles the favorite", async () => {
    const channel: Channel = { id: 2, name: "Made-up Movie", media_type: MediaType.movie, favorite: false };
    const fixture = await render(channel);
    await fixture.componentInstance.toggleFavorite();
    expect(channel.favorite).toBeTrue();
  });
});
