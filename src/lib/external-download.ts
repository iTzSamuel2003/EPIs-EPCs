export function openPendingDownload() {
  const popup = window.open("about:blank", "_blank");
  if (popup) {
    popup.opener = null;
    popup.document.title = "Abrindo documento...";
  }
  return popup;
}

export function finishPendingDownload(popup: Window | null, url: string) {
  if (!popup) return;
  popup.location.replace(url);
}

export function closePendingDownload(popup: Window | null) {
  if (popup && !popup.closed) popup.close();
}
