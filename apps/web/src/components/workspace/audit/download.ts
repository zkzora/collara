/**
 * Opens a short-lived link issued after the server-side access check (never a stored URL).
 * `data:` links (UI_MOCK placeholders and mock reports) are saved as files instead of opened.
 */
export function openDownload(url: string, fileName: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  if (url.startsWith("data:") || url.startsWith("blob:")) anchor.download = fileName;
  else anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
