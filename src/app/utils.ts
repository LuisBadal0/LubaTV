export const isInputFocused = () => {
  var activeElement = document.activeElement;
  var inputs = ["input", "select", "button", "textarea"];
  return activeElement && inputs.indexOf(activeElement.tagName?.toLowerCase()) !== -1;
};

export const sanitizeFileName = (fileName: string) => {
  return (
    fileName
      .replace(/[\/\\:*?"<>|]/g, "_")
      .replace(/[\x00-\x1F\x7F]/g, "")
      .replace(/^\.+/, "")
      .replace(/\.+$/, "")
      .replace(/^\s+|\s+$/g, "") || "untitled"
  );
};

export const getDateFormatted = (): string => {
  return new Date().toISOString().replace(/T|:/g, "-").split(".")[0];
};

/**
 * The extension for a saved file, from the last part of the address's path:
 * ".../42.mkv?token=1" gives "mkv". Addresses without one, such as "http://host.com/live"
 * or PHP links, get "mp4". Matches get_extension in src-tauri/src/utils.rs.
 */
export const getExtension = (url: string): string => {
  const path = url.split(/[?#]/)[0].replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  const name = path.substring(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "" : name.substring(dot + 1);
  return /^[a-z0-9]{1,5}$/i.test(extension) && extension.toLowerCase() !== "php"
    ? extension
    : "mp4";
};
