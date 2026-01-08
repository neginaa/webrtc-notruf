// shared.js -> global helper unter window.Shared
(() => {
  const Shared = {};

  Shared.MSG = {
    OFFER: 'offer',
    ANSWER: 'answer',
    ICE: 'ice-candidate',
    MODE: 'mode',
    PHOTO: 'photo',
    ORIENTATION: 'orientation',
    OVERLAY_SET: 'overlay_set',
    HANGUP: 'hangup',
  };

  Shared.wsUrl = function wsUrl(roomId, role) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // wichtig: "/?" (stabiler bei Proxies/ngrok)
    return `${proto}://${location.host}/?room=${encodeURIComponent(roomId)}&role=${encodeURIComponent(role)}`;
  };

  Shared.safeParse = function safeParse(x) {
    try { return JSON.parse(x); } catch { return null; }
  };

  Shared.kindToEmoji = function kindToEmoji(kind) {
    switch (kind) {
      case 'arrow-up': return '⬆️';
      case 'arrow-down': return '⬇️';
      case 'arrow-left': return '⬅️';
      case 'arrow-right': return '➡️';
      case 'circle': return '⭕';
      default: return '⭕';
    }
  };

  Shared.clamp01 = function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  };

  Shared.getDisplayedVideoRect = function getDisplayedVideoRect(videoEl, wrapEl) {
    const wrapRect = wrapEl.getBoundingClientRect();
    const cw = wrapRect.width;
    const ch = wrapRect.height;

    const vw = videoEl.videoWidth || 0;
    const vh = videoEl.videoHeight || 0;

    if (!vw || !vh || !cw || !ch) {
      return { left: 0, top: 0, width: cw, height: ch };
    }

    const fit = getComputedStyle(videoEl).objectFit || 'contain';
    const scale = (fit === 'cover')
      ? Math.max(cw / vw, ch / vh)
      : Math.min(cw / vw, ch / vh);

    const dw = vw * scale;
    const dh = vh * scale;
    const ox = (cw - dw) / 2;
    const oy = (ch - dh) / 2;

    return { left: ox, top: oy, width: dw, height: dh };
  };

  Shared.getOrientation = function getOrientation() {
    if (window.screen?.orientation?.type) {
      return window.screen.orientation.type.startsWith('landscape') ? 'landscape' : 'portrait';
    }
    return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
  };

  window.Shared = Shared;
})();
