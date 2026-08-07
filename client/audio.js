// audio.js - 轻量程序化音效层，无需额外音频素材
(function () {
  'use strict';

  const STORAGE_KEY = 'bloodgun-audio-enabled';
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let enabled = true;
  let audioContext = null;
  let masterGain = null;
  let noiseBuffer = null;

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) enabled = saved !== 'off';
  } catch (error) {
    // 浏览器隐私模式下可能无法访问 localStorage。
  }

  function getContext() {
    if (!AudioContextClass || !enabled) return null;
    if (!audioContext) {
      try {
        audioContext = new AudioContextClass();
        masterGain = audioContext.createGain();
        masterGain.gain.value = 0.24;
        masterGain.connect(audioContext.destination);
      } catch (error) {
        audioContext = null;
        masterGain = null;
        return null;
      }
    }
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
  }

  function getNoiseBuffer(ctx) {
    if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
    const length = Math.floor(ctx.sampleRate * 0.55);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }

  function tone(options) {
    const ctx = getContext();
    if (!ctx) return;
    const opts = options || {};
    const start = ctx.currentTime + (opts.delay || 0);
    const duration = Math.max(0.025, opts.duration || 0.12);
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const type = opts.type || 'sine';
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(24, opts.frequency || 440), start);
    if (opts.toFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(24, opts.toFrequency), start + duration);
    }
    if (opts.detune) oscillator.detune.setValueAtTime(opts.detune, start);
    const volume = Math.max(0.0001, opts.gain || 0.08);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.018, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.025);
  }

  function noise(options) {
    const ctx = getContext();
    if (!ctx) return;
    const opts = options || {};
    const start = ctx.currentTime + (opts.delay || 0);
    const duration = Math.max(0.025, opts.duration || 0.16);
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = getNoiseBuffer(ctx);
    filter.type = opts.filterType || 'bandpass';
    filter.frequency.setValueAtTime(opts.frequency || 1200, start);
    filter.Q.setValueAtTime(opts.q || 0.7, start);
    const volume = Math.max(0.0001, opts.gain || 0.1);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.012, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    source.start(start);
    source.stop(start + duration + 0.025);
  }

  const sounds = {
    ui() {
      tone({ frequency: 420, toFrequency: 620, duration: 0.07, gain: 0.045, type: 'triangle' });
    },
    turn() {
      tone({ frequency: 150, toFrequency: 235, duration: 0.18, gain: 0.07, type: 'triangle' });
      tone({ frequency: 470, duration: 0.06, gain: 0.035, type: 'sine', delay: 0.08 });
    },
    pickup() {
      noise({ frequency: 850, duration: 0.07, gain: 0.07, filterType: 'highpass' });
      tone({ frequency: 105, toFrequency: 180, duration: 0.18, gain: 0.1, type: 'triangle', delay: 0.025 });
      tone({ frequency: 540, duration: 0.09, gain: 0.05, type: 'sine', delay: 0.11 });
    },
    shot() {
      noise({ frequency: 760, duration: 0.24, gain: 0.34, filterType: 'lowpass', q: 0.55 });
      tone({ frequency: 92, toFrequency: 42, duration: 0.3, gain: 0.22, type: 'sawtooth' });
      tone({ frequency: 680, toFrequency: 180, duration: 0.08, gain: 0.08, type: 'square' });
    },
    dry() {
      noise({ frequency: 2100, duration: 0.055, gain: 0.1, filterType: 'highpass', q: 1.5 });
      tone({ frequency: 180, toFrequency: 90, duration: 0.1, gain: 0.07, type: 'triangle' });
    },
    impact() {
      noise({ frequency: 420, duration: 0.18, gain: 0.18, filterType: 'lowpass', q: 0.8 });
      tone({ frequency: 64, toFrequency: 34, duration: 0.24, gain: 0.16, type: 'sine' });
    },
    shield() {
      tone({ frequency: 280, toFrequency: 760, duration: 0.28, gain: 0.1, type: 'sine' });
      tone({ frequency: 560, toFrequency: 980, duration: 0.22, gain: 0.06, type: 'triangle', delay: 0.05 });
    },
    power() {
      tone({ frequency: 120, toFrequency: 420, duration: 0.38, gain: 0.1, type: 'sawtooth' });
      tone({ frequency: 240, toFrequency: 840, duration: 0.32, gain: 0.055, type: 'sine', delay: 0.08 });
    },
    peek() {
      tone({ frequency: 720, toFrequency: 1160, duration: 0.16, gain: 0.075, type: 'triangle' });
      tone({ frequency: 1440, duration: 0.08, gain: 0.04, type: 'sine', delay: 0.13 });
    },
    eject() {
      noise({ frequency: 1800, duration: 0.1, gain: 0.1, filterType: 'highpass', q: 1.1 });
      tone({ frequency: 940, toFrequency: 520, duration: 0.2, gain: 0.08, type: 'triangle', delay: 0.04 });
    },
    reload() {
      noise({ frequency: 520, duration: 0.16, gain: 0.1, filterType: 'bandpass', q: 1.2 });
      tone({ frequency: 160, toFrequency: 82, duration: 0.2, gain: 0.09, type: 'triangle', delay: 0.16 });
      tone({ frequency: 780, duration: 0.09, gain: 0.045, type: 'sine', delay: 0.39 });
      tone({ frequency: 1160, duration: 0.12, gain: 0.055, type: 'triangle', delay: 0.72 });
    },
    win() {
      tone({ frequency: 392, toFrequency: 784, duration: 0.42, gain: 0.1, type: 'triangle' });
      tone({ frequency: 587, toFrequency: 1174, duration: 0.5, gain: 0.07, type: 'sine', delay: 0.12 });
      tone({ frequency: 784, duration: 0.32, gain: 0.06, type: 'sine', delay: 0.36 });
    },
    lose() {
      tone({ frequency: 220, toFrequency: 70, duration: 0.6, gain: 0.12, type: 'sawtooth' });
      noise({ frequency: 180, duration: 0.35, gain: 0.08, filterType: 'lowpass', delay: 0.18 });
    }
  };

  function updateToggle() {
    const toggle = document.getElementById('sound-toggle');
    if (!toggle) return;
    toggle.classList.toggle('is-muted', !enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.setAttribute('title', enabled ? '关闭音效' : '开启音效');
    const label = toggle.querySelector('.sound-toggle-label');
    if (label) label.textContent = enabled ? '音效开' : '音效关';
  }

  function setEnabled(value) {
    enabled = !!value;
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch (error) {
      // 忽略无法持久化的情况。
    }
    updateToggle();
    if (enabled) {
      getContext();
      sounds.ui();
    }
  }

  window.GameAudio = {
    unlock: getContext,
    play(name) {
      if (!enabled || !sounds[name]) return;
      sounds[name]();
    },
    isEnabled() {
      return enabled;
    },
    setEnabled,
    toggle() {
      setEnabled(!enabled);
    }
  };

  document.addEventListener('pointerdown', function (event) {
    if (event.button !== undefined && event.button !== 0) return;
    getContext();
    const target = event.target.closest?.('button, .item-slot, .stepper-btn');
    if (target && target.id !== 'sound-toggle') sounds.ui();
  }, true);
  document.addEventListener('keydown', function () {
    getContext();
  }, true);
  document.addEventListener('DOMContentLoaded', updateToggle, { once: true });
  updateToggle();
})();
