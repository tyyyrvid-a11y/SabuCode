const Haptics = (() => {
  let enabled = true;

  function setEnabled(value) {
    enabled = value;
  }

  function vibrate(pattern) {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* unsupported */
    }
  }

  return {
    setEnabled,
    tap: () => vibrate(10),
    send: () => vibrate([12, 30, 12]),
    success: () => vibrate([10, 40, 10, 40, 20]),
    error: () => vibrate([40, 30, 40])
  };
})();
