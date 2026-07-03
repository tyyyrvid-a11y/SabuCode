const Sound = (() => {
  let ctx = null;
  let enabled = true;

  function setEnabled(value) {
    enabled = value;
  }

  function getCtx() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioCtx();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone({ freq = 440, duration = 0.09, type = 'sine', gain = 0.06, glideTo = null, delay = 0 }) {
    if (!enabled) return;
    try {
      const audio = getCtx();
      const osc = audio.createOscillator();
      const gainNode = audio.createGain();
      const start = audio.currentTime + delay;

      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + duration);

      gainNode.gain.setValueAtTime(0, start);
      gainNode.gain.linearRampToValueAtTime(gain, start + 0.008);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gainNode).connect(audio.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    } catch {
      /* audio unsupported / blocked until user gesture */
    }
  }

  return {
    setEnabled,
    tap: () => tone({ freq: 720, duration: 0.05, type: 'triangle', gain: 0.045 }),
    send: () => {
      tone({ freq: 480, duration: 0.09, type: 'sine', glideTo: 760, gain: 0.06 });
    },
    receiveStart: () => tone({ freq: 300, duration: 0.06, type: 'sine', gain: 0.03 }),
    success: () => {
      tone({ freq: 523.25, duration: 0.1, type: 'triangle', gain: 0.05 });
      tone({ freq: 659.25, duration: 0.12, type: 'triangle', gain: 0.05, delay: 0.08 });
      tone({ freq: 783.99, duration: 0.16, type: 'triangle', gain: 0.05, delay: 0.16 });
    },
    error: () => {
      tone({ freq: 220, duration: 0.16, type: 'sawtooth', gain: 0.05 });
      tone({ freq: 160, duration: 0.22, type: 'sawtooth', gain: 0.05, delay: 0.1 });
    }
  };
})();
