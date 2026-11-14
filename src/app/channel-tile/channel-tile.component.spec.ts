import { TestBed } from "@angular/core/testing";
import { MatMenuModule } from "@angular/material/menu";
import { NgbTooltipModule } from "@ng-bootstrap/ng-bootstrap";
import { ChannelTileComponent } from "./channel-tile.component";
import { Channel } from "../models/channel";
import { MediaType } from "../models/mediaType";
import { mockTauri, TEST_IMPORTS, TEST_PROVIDERS, TEST_SCHEMAS } from "../../testing/test-setup";

describe("ChannelTileComponent", () => {
  beforeEach(async () => {
    mockTauri();
    await TestBed.configureTestingModule({
      declarations: [ChannelTileComponent],
      imports: [...TEST_IMPORTS, NgbTooltipModule, MatMenuModule],
      providers: TEST_PROVIDERS,
      schemas: TEST_SCHEMAS,
    }).compileComponents();
  });

  function render(channel: Channel, poster = false) {
    const fixture = TestBed.createComponent(ChannelTileComponent);
    fixture.componentRef.setInput("channel", channel);
    fixture.componentRef.setInput("id", 0);
    fixture.componentRef.setInput("poster", poster);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector(".tile")!;
  }

  it("shows a channel's logo whole", () => {
    const tile = render({ id: 1, name: "Made-up Channel", image: "logo.png", media_type: MediaType.livestream });
    expect(tile.classList).toContain("art");
    expect(tile.querySelector(".plate")?.classList).not.toContain("cover");
  });

  it("fills the tile with a movie's picture", () => {
    const tile = render({ id: 2, name: "Made-up Movie", image: "poster.png", media_type: MediaType.movie });
    expect(tile.querySelector(".plate")?.classList).toContain("cover");
  });

  it("falls back to initials when a movie has no picture", () => {
    const tile = render({ id: 3, name: "Made-up Movie", media_type: MediaType.movie });
    expect(tile.querySelector(".plate")?.classList).not.toContain("cover");
    expect(tile.querySelector(".initials")?.textContent).toBe("MU");
  });

  it("stands upright in a grid of posters", () => {
    const tile = render({ id: 4, name: "Made-up Series", image: "poster.png", media_type: MediaType.serie }, true);
    expect(tile.classList).toContain("poster");
  });

  it("keeps a category as a plain card, never a poster", () => {
    const tile = render({ id: 5, name: "Made-up Category", media_type: MediaType.group }, true);
    expect(tile.classList).not.toContain("art");
    expect(tile.classList).not.toContain("poster");
  });
});
