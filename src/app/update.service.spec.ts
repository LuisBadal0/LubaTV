import { TestBed } from "@angular/core/testing";
import { DownloadEvent } from "@tauri-apps/plugin-updater";
import { UpdateService } from "./update.service";
import { mockTauri } from "../testing/test-setup";

/** A stand-in for the updater's Update: a 10 MB download in two chunks. */
function fakeUpdate(options: { failDownload?: boolean; failInstall?: boolean } = {}) {
  return {
    version: "9.9.9",
    body: "### Fixed\n\n- Something",
    download: jasmine
      .createSpy("download")
      .and.callFake(async (onEvent: (e: DownloadEvent) => void) => {
        onEvent({ event: "Started", data: { contentLength: 10485760 } });
        onEvent({ event: "Progress", data: { chunkLength: 4194304 } });
        if (options.failDownload) throw "connection reset";
        onEvent({ event: "Progress", data: { chunkLength: 6291456 } });
        onEvent({ event: "Finished" });
      }),
    install: jasmine.createSpy("install").and.callFake(async () => {
      if (options.failInstall) throw "installer could not start";
    }),
  };
}

describe("UpdateService", () => {
  let service: UpdateService;
  let notification: jasmine.Spy;

  beforeEach(() => {
    mockTauri({ "plugin:notification|is_permission_granted": true });
    // The browser's own Notification is what the plugin uses to show one.
    notification = spyOn(window as any, "Notification");
    Object.defineProperty(notification, "permission", { value: "default" });
    TestBed.configureTestingModule({});
    service = TestBed.inject(UpdateService);
    service.installNoticeMs = 0;
  });

  function offer(update: ReturnType<typeof fakeUpdate>) {
    (service as any).update = update;
    service.version = update.version;
    service.state = "available";
  }

  it("downloads with progress, then installs and tells the viewer LubaTV comes back", async () => {
    const update = fakeUpdate();
    offer(update);
    const seen: string[] = [];
    update.download.and.callFake(async (onEvent: (e: DownloadEvent) => void) => {
      onEvent({ event: "Started", data: { contentLength: 10485760 } });
      onEvent({ event: "Progress", data: { chunkLength: 4194304 } });
      seen.push(`${service.state} ${service.progress}% ${service.received}/${service.total}`);
      onEvent({ event: "Progress", data: { chunkLength: 6291456 } });
      onEvent({ event: "Finished" });
    });
    update.install.and.callFake(async () => {
      seen.push(`${service.state} ${service.progress}%`);
    });

    await service.install();

    expect(seen).toEqual(["downloading 40% 4194304/10485760", "installing 100%"]);
    expect(service.updating).toBeTrue();
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(notification).toHaveBeenCalledWith(
      "Installing LubaTV 9.9.9",
      jasmine.objectContaining({ body: "LubaTV reopens by itself in a few seconds." }),
    );
  });

  it("keeps the update on offer after a failed download, without installing", async () => {
    const update = fakeUpdate({ failDownload: true });
    offer(update);

    await service.install();

    expect(service.state).toBe("error");
    expect(service.failedStep).toBe("download");
    expect(service.error).toContain("connection reset");
    expect(update.install).not.toHaveBeenCalled();
    expect(service.updating).toBeTrue();

    service.closeUpdate();
    expect(service.updating).toBeFalse();
    expect(service.state).toBe("available");
    expect(service.error).toBeUndefined();
  });

  it("reports an installer that doesn't start, and retries without downloading again", async () => {
    const update = fakeUpdate({ failInstall: true });
    offer(update);

    await service.install();

    expect(service.state).toBe("error");
    expect(service.failedStep).toBe("install");
    expect(service.error).toContain("installer could not start");

    update.install.and.resolveTo();
    await service.install();

    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(2);
    expect(service.failedStep).toBeUndefined();
  });

  it("closes the players before handing over to the installer", async () => {
    const calls: string[] = [];
    mockTauri({ "plugin:notification|is_permission_granted": true });
    const { mockIPC } = await import("@tauri-apps/api/mocks");
    mockIPC((cmd) => {
      calls.push(cmd);
      return cmd == "plugin:notification|is_permission_granted" ? true : null;
    });
    const update = fakeUpdate();
    update.install.and.callFake(async () => {
      calls.push("install");
    });
    offer(update);

    await service.install();

    expect(calls.indexOf("close_players")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("close_players")).toBeLessThan(calls.indexOf("install"));
  });

  it("still installs when notifications aren't allowed", async () => {
    mockTauri({ "plugin:notification|is_permission_granted": false });
    const update = fakeUpdate();
    offer(update);

    await service.install();

    expect(notification).not.toHaveBeenCalled();
    expect(update.install).toHaveBeenCalledTimes(1);
  });

  it("can't be closed while it is still working", () => {
    service.updating = true;
    service.state = "downloading";
    service.closeUpdate();
    expect(service.updating).toBeTrue();
  });
});
