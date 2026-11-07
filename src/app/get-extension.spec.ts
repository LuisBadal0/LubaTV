import { getExtension } from "./utils";

// The same cases as get_extension's tests in src-tauri/src/utils.rs.
describe("getExtension", () => {
  it("takes the extension from the file name", () => {
    expect(getExtension("http://host:8080/movie/user/pass/42.mkv")).toBe("mkv");
    expect(getExtension("http://host/live/user/pass/7.ts")).toBe("ts");
    expect(getExtension("https://cdn.example.com/hls/index.m3u8")).toBe("m3u8");
  });

  it("ignores the query and fragment", () => {
    expect(getExtension("http://host/42.mp4?token=a.b.c")).toBe("mp4");
    expect(getExtension("http://host/42.avi#t=10")).toBe("avi");
  });

  it("ignores dots in the host and folders", () => {
    expect(getExtension("http://provider.example.com/live/123")).toBe("mp4");
    expect(getExtension("http://10.0.0.1:8080")).toBe("mp4");
    expect(getExtension("http://host/v1.2/stream")).toBe("mp4");
  });

  it("uses mp4 for PHP links and odd endings", () => {
    expect(getExtension("http://host/get.php?id=1&type=m3u")).toBe("mp4");
    expect(getExtension("http://host/file.")).toBe("mp4");
    expect(getExtension("http://host/name.with spaces")).toBe("mp4");
  });
});
