interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
export function installControl(
  changed: (visible: boolean) => void,
  showIosHint: () => void,
) {
  const abort = new AbortController();
  let deferred: InstallPrompt | null = null;
  const installed =
    matchMedia("(display-mode: standalone)").matches ||
    matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!installed) {
    changed(
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    );
    window.addEventListener(
      "beforeinstallprompt",
      (event) => {
        event.preventDefault();
        deferred = event as InstallPrompt;
        changed(true);
      },
      { signal: abort.signal },
    );
    window.addEventListener(
      "appinstalled",
      () => {
        deferred = null;
        changed(false);
      },
      { signal: abort.signal },
    );
  }
  return {
    async prompt() {
      if (!deferred) {
        showIosHint();
        return;
      }
      const prompt = deferred;
      deferred = null;
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === "accepted") changed(false);
    },
    dispose() {
      abort.abort();
      deferred = null;
    },
  };
}
