(() => {
  const roomInfo = document.getElementById('roomInfo');
  const callerLink = document.getElementById('callerLink');

  const statusEl = document.getElementById('status');
  const statusBadge = document.getElementById('statusBadge');

  const remoteVideo = document.getElementById('remote');
  const remoteAudio = document.getElementById('remoteAudio');

  const videoWrap = document.getElementById('videoWrap');
  const overlayLayer = document.getElementById('overlayLayer');
  const palette = document.getElementById('palette');

  const audioOnlyOverlay = document.getElementById('audioOnlyOverlay');

  const createBtn = document.getElementById('create');
  const copyBtn = document.getElementById('copyLink');
  const muteBtn = document.getElementById('muteRemote');

  const photoImg = document.getElementById('photoPreview');
  const photoHint = document.getElementById('photoHint');

  remoteVideo.muted = true;
  remoteVideo.playsInline = true;
  remoteAudio.volume = 0.4;

  let ws = null;
  let pc = null;

  let overlays = []; // {id, kind, x, y}
  let draggingOverlayId = null;
  let dragOffset = { x: 0, y: 0 };

  function setStatus(text, state) {
    statusEl.textContent = text;
    statusBadge.setAttribute('data-state', state);
  }

  function showAudioOnly(on) {
    audioOnlyOverlay.style.display = on ? 'flex' : 'none';
  }

  function updateVideoAspectFromStream() {
    const vw = remoteVideo.videoWidth || 0;
    const vh = remoteVideo.videoHeight || 0;
    if (!vw || !vh) return;
    videoWrap.style.setProperty('--video-ar', `${vw} / ${vh}`);
    renderOverlays();
  }

  function getRelativeXYOnVideo(clientX, clientY) {
    const wrapRect = videoWrap.getBoundingClientRect();
    const vr = Shared.getDisplayedVideoRect(remoteVideo, videoWrap);

    const lx = clientX - wrapRect.left;
    const ly = clientY - wrapRect.top;

    const vx = (lx - vr.left) / vr.width;
    const vy = (ly - vr.top) / vr.height;

    return { x: Shared.clamp01(vx), y: Shared.clamp01(vy) };
  }

  function videoXYToWrapPx(x, y) {
    const vr = Shared.getDisplayedVideoRect(remoteVideo, videoWrap);
    return { px: vr.left + x * vr.width, py: vr.top + y * vr.height };
  }

  function renderOverlays() {
    overlayLayer.innerHTML = '';

    for (const o of overlays) {
      const el = document.createElement('div');
      el.className = 'overlay-item';
      el.textContent = Shared.kindToEmoji(o.kind);
      el.dataset.id = o.id;

      const p = videoXYToWrapPx(o.x, o.y);
      el.style.left = p.px + 'px';
      el.style.top = p.py + 'px';

      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        draggingOverlayId = o.id;
        el.setPointerCapture(e.pointerId);

        const pos = getRelativeXYOnVideo(e.clientX, e.clientY);
        dragOffset.x = pos.x - o.x;
        dragOffset.y = pos.y - o.y;
      });

      el.addEventListener('pointermove', (e) => {
        if (!draggingOverlayId || draggingOverlayId !== o.id) return;

        const pos = getRelativeXYOnVideo(e.clientX, e.clientY);
        o.x = Shared.clamp01(pos.x - dragOffset.x);
        o.y = Shared.clamp01(pos.y - dragOffset.y);

        const p2 = videoXYToWrapPx(o.x, o.y);
        el.style.left = p2.px + 'px';
        el.style.top = p2.py + 'px';
      });

      el.addEventListener('pointerup', () => {
        if (!draggingOverlayId) return;
        draggingOverlayId = null;
        sendOverlays();
      });

      el.addEventListener('dblclick', () => {
        overlays = overlays.filter(x => x.id !== o.id);
        renderOverlays();
        sendOverlays();
      });

      overlayLayer.appendChild(el);
    }
  }

  function sendOverlays() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: Shared.MSG.OVERLAY_SET, overlays }));
    }
  }

  // Palette Drag & Drop
  palette.querySelectorAll('.palette-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', item.dataset.kind);
    });
  });

  videoWrap.addEventListener('dragover', (e) => e.preventDefault());

  videoWrap.addEventListener('drop', (e) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('text/plain');
    if (!kind) return;

    const pos = getRelativeXYOnVideo(e.clientX, e.clientY);
    const id = 'ov_' + Math.random().toString(16).slice(2);

    overlays.push({ id, kind, x: pos.x, y: pos.y });
    renderOverlays();
    sendOverlays();
  });

  window.addEventListener('resize', () => {
    updateVideoAspectFromStream();
    renderOverlays();
  });
  remoteVideo.addEventListener('loadedmetadata', updateVideoAspectFromStream);
  remoteVideo.addEventListener('resize', updateVideoAspectFromStream);

  // Copy Link
  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(callerLink.value); } catch {}
  };

  // Mute
  muteBtn.onclick = () => {
    remoteAudio.muted = !remoteAudio.muted;
    muteBtn.textContent = remoteAudio.muted ? '🔊 Ton an' : '🔇 Ton aus';
  };

  async function addDispatcherMic() {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }
      });
      mic.getTracks().forEach(t => pc.addTrack(t, mic));
    } catch {}
  }

  async function setup(roomId) {
    setStatus('verbinden…', 'warn');

    ws = new WebSocket(Shared.wsUrl(roomId, 'dispatcher'));
    ws.onerror = () => setStatus('ws fehler', 'err');
    ws.onclose = () => { setStatus('getrennt', 'warn'); showAudioOnly(false); };

    pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
    });

    await addDispatcherMic();

    pc.onicecandidate = (e) => {
      if (e.candidate && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: Shared.MSG.ICE, candidate: e.candidate }));
      }
    };

    pc.ontrack = async (e) => {
      const stream = e.streams[0];
      remoteVideo.srcObject = stream;
      remoteAudio.srcObject = stream;

      try { await remoteVideo.play(); } catch {}
      try { await remoteAudio.play(); } catch {}

      setStatus('verbunden', 'ok');
      showAudioOnly(false);

      setTimeout(updateVideoAspectFromStream, 80);
    };

    ws.onopen = () => {
      // initial overlay sync
      sendOverlays();
    };

    ws.onmessage = async (evt) => {
      let raw = evt.data;
      if (raw instanceof Blob) raw = await raw.text();
      const msg = Shared.safeParse(raw);
      if (!msg) return;

      if (msg.type === Shared.MSG.OFFER) {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: Shared.MSG.ANSWER, sdp: pc.localDescription }));

      } else if (msg.type === Shared.MSG.ICE) {
        try { await pc.addIceCandidate(msg.candidate); } catch {}

      } else if (msg.type === Shared.MSG.MODE) {
        showAudioOnly(msg.mode === 'audio-only');

      } else if (msg.type === Shared.MSG.PHOTO) {
        photoImg.src = msg.dataUrl;
        photoHint.textContent = 'Foto empfangen.';

      } else if (msg.type === Shared.MSG.ORIENTATION) {
        // grob setzen; korrekt wird später durch loadedmetadata überschrieben
        if (msg.value === 'landscape') videoWrap.style.setProperty('--video-ar', '16 / 9');
        else videoWrap.style.setProperty('--video-ar', '9 / 16');
        renderOverlays();
      }
    };
  }

  async function newRoom() {
    const r = await fetch('/api/new-room');
    const data = await r.json();
    const roomId = data.roomId;

    const url = new URL(location.href);
    url.pathname = '/caller.html';
    url.search = '?room=' + roomId;

    roomInfo.textContent = roomId;
    callerLink.value = url.toString();

    overlays = [];
    renderOverlays();
    photoHint.textContent = 'Noch kein Foto empfangen.';
    photoImg.removeAttribute('src');

    await setup(roomId);
  }

  createBtn.onclick = newRoom;
  setStatus('getrennt', 'warn');
})();
