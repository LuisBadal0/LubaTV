import { getDateFormatted, getExtension, isInputFocused, sanitizeFileName } from "./utils";

describe("sanitizeFileName", () => {
  it("replaces characters Windows doesn't allow in file names", () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("removes control characters", () => {
    expect(sanitizeFileName("News\u0000 \u001fHD\u007f")).toBe("News HD");
  });

  it("trims leading and trailing dots and spaces", () => {
    expect(sanitizeFileName("  Movie  ")).toBe("Movie");
    expect(sanitizeFileName("...Movie...")).toBe("Movie");
  });

  it("falls back to 'untitled' when nothing is left", () => {
    expect(sanitizeFileName("")).toBe("untitled");
    expect(sanitizeFileName("...")).toBe("untitled");
  });
});

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

describe("getDateFormatted", () => {
  it("formats the current UTC time so it can go in a file name", () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(Date.UTC(2026, 0, 15, 9, 5, 7)));
    try {
      expect(getDateFormatted()).toBe("2026-01-15-09-05-07");
    } finally {
      jasmine.clock().uninstall();
    }
  });
});

describe("isInputFocused", () => {
  afterEach(() => (document.activeElement as HTMLElement | null)?.blur());

  it("is true while a text field has focus", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(isInputFocused()).toBeTrue();
    input.remove();
  });

  it("is false when nothing has focus", () => {
    expect(isInputFocused()).toBeFalse();
  });
});
