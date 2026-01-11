(() => {
  const params = new URLSearchParams(location.search);
  const roomId = params.get("room");

  const roomLabel = document.getElementById("roomLabel");
  roomLabel.textContent = roomId || "-";

  const statusBadge = document.getElementById("statusBadge");
  const statusText = document.getElementById("statusText");

  const controlsStart = document.getElementById("controlsStart");
  const controlsInCall = document.getElementById("controlsInCall");

  const localVideoEl = document.getElementById("local");
  const remoteAudioEl = document.getElementById("remoteAudio");

  const overlayLayer = document.getElementById("callerOverlayLayer");
  const overlayHint = document.getElementById("callerOverlayHint");
  const videoWrap = document.getElementById("callerVideoWrap");

  const startBtn = document.getElementById("start");
  const audioOnlyBtn = document.getElementById("audioOnly");
  const sendPhotoBtn = document.getElementById("sendPhoto");
  const hangupBtn = document.getElementById("hangup");

  const canvas = document.getElementById("snapshotCanvas");

  let ws = null;
  let pc = null;
  let localStream = null;

  let overlays = []; // {id, kind, x, y}

  function setStatus(text, state) {
    statusText.textContent = text;
    statusBadge.setAttribute("data-state", state);
  }

  function showInCallUI() {
    controlsStart.classList.add("is-hidden");
    controlsInCall.classList.remove("is-hidden");
  }

  function showStartUI() {
    controlsInCall.classList.add("is-hidden");
    controlsStart.classList.remove("is-hidden");
  }

  function renderOverlays() {
    overlayLayer.innerHTML = "";

    const vr = Shared.getDisplayedVideoRect(localVideoEl, videoWrap);

    for (const o of overlays) {
      const el = document.createElement("div");
      el.className = "caller-overlay-item";
      el.textContent = Shared.kindToEmoji(o.kind);

      const px = vr.left + o.x * vr.width;
      const py = vr.top + o.y * vr.height;

      el.style.left = px + "px";
      el.style.top = py + "px";

      overlayLayer.appendChild(el);
    }

    overlayHint.style.display = overlays.length ? "block" : "none";
  }

  window.addEventListener("resize", renderOverlays);
  localVideoEl.addEventListener("loadedmetadata", renderOverlays);

  function notifyOrientation() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: Shared.MSG.ORIENTATION,
          value: Shared.getOrientation(),
        })
      );
    }
  }

  window.addEventListener("orientationchange", notifyOrientation);
  window.addEventListener("resize", notifyOrientation);

  async function start() {
    if (!roomId) {
      alert("Kein Raum angegeben.");
      return;
    }

    showInCallUI();
    setStatus("starten…", "warn");

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 640 },
          frameRate: { ideal: 15, max: 15 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (e) {
      console.error(e);
      alert("Kamera/Mikrofon konnte nicht gestartet werden.");
      showStartUI();
      setStatus("bereit", "warn");
      return;
    }

    localVideoEl.srcObject = localStream;

    ws = new WebSocket(Shared.wsUrl(roomId, "caller"));
    ws.onerror = () => setStatus("ws fehler", "err");
    ws.onclose = () => setStatus("getrennt", "warn");

    pc = new RTCPeerConnection({
      iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
    });

    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }

    pc.ontrack = (e) => {
      remoteAudioEl.srcObject = e.streams[0];
    };

    pc.onicecandidate = (e) => {
      if (e.candidate && ws?.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: Shared.MSG.ICE,
            candidate: e.candidate,
          })
        );
      }
    };

    async function sendOffer() {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });

      await pc.setLocalDescription(offer);

      ws.send(
        JSON.stringify({
          type: Shared.MSG.OFFER,
          sdp: pc.localDescription,
        })
      );

      ws.send(
        JSON.stringify({
          type: Shared.MSG.MODE,
          mode: "av",
        })
      );

      setStatus("verbinden…", "warn");
      notifyOrientation();
    }

    ws.onopen = () => {
      // Buttons freischalten (werden wirklich nutzbar nach Answer, aber UI ok)
      audioOnlyBtn.disabled = true;
      sendPhotoBtn.disabled = true;

      // Offer senden
      sendOffer().catch(console.error);
    };

    ws.onmessage = async (evt) => {
      let raw = evt.data;
      if (raw instanceof Blob) raw = await raw.text();

      const msg = Shared.safeParse(raw);
      if (!msg) return;

      if (msg.type === Shared.MSG.ANSWER) {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        setStatus("laufend", "ok");
        audioOnlyBtn.disabled = false;
        sendPhotoBtn.disabled = false;
      } else if (msg.type === Shared.MSG.ICE) {
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch {}
      } else if (msg.type === Shared.MSG.OVERLAY_SET) {
        overlays = Array.isArray(msg.overlays) ? msg.overlays : [];
        renderOverlays();
      }
    };

    audioOnlyBtn.onclick = () => {
      const vTrack = localStream?.getVideoTracks?.()[0];
      if (!vTrack) return;

      vTrack.enabled = !vTrack.enabled;

      if (vTrack.enabled) {
        audioOnlyBtn.textContent = "Nur Audio";
        ws?.send(JSON.stringify({ type: Shared.MSG.MODE, mode: "av" }));
      } else {
        audioOnlyBtn.textContent = "Video wieder an";
        ws?.send(JSON.stringify({ type: Shared.MSG.MODE, mode: "audio-only" }));
      }
    };

    sendPhotoBtn.onclick = () => {
      if (!localStream || !ws || ws.readyState !== WebSocket.OPEN) {
        alert("Verbindung noch nicht bereit.");
        return;
      }

      if (!localVideoEl.videoWidth || !localVideoEl.videoHeight) {
        alert("Video noch nicht bereit für ein Foto.");
        return;
      }

      const ctx = canvas.getContext("2d");

      canvas.width = localVideoEl.videoWidth;
      canvas.height = localVideoEl.videoHeight;

      ctx.drawImage(localVideoEl, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      ws.send(JSON.stringify({ type: Shared.MSG.PHOTO, dataUrl }));

      const old = sendPhotoBtn.textContent;
      sendPhotoBtn.textContent = "📷 Foto gesendet";
      sendPhotoBtn.disabled = true;

      setTimeout(() => {
        sendPhotoBtn.textContent = old;
        sendPhotoBtn.disabled = false;
      }, 1200);
    };

    hangupBtn.onclick = hangup;
  }

  function hangup() {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: Shared.MSG.HANGUP }));
        ws.close();
      }
    } catch {}

    try {
      pc?.close();
    } catch {}

    try {
      localStream?.getTracks?.().forEach((t) => t.stop());
    } catch {}

    overlays = [];
    renderOverlays();

    audioOnlyBtn.disabled = true;
    audioOnlyBtn.textContent = "Nur Audio";
    sendPhotoBtn.disabled = true;

    localVideoEl.srcObject = null;
    remoteAudioEl.srcObject = null;

    setStatus("getrennt", "warn");
    showStartUI();
  }

  startBtn.onclick = start;
})();
