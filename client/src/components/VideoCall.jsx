import { useState, useRef, useEffect, useCallback } from "react";
import {
  ArrowLeft, Mic, MicOff, Video, VideoOff, PhoneOff,
  MonitorUp, Users, Maximize2, Minimize2, PictureInPicture2,
  Clock,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import UserAvatar from "./UserAvatar";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

function formatDuration(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function AudioBars({ level, active }) {
  const heights = [0.5, 1.0, 0.7];
  return (
    <div className="flex items-end gap-[2px] h-3">
      {heights.map((h, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full transition-all duration-75"
          style={{
            height: active ? `${Math.max(3, Math.round(level * 12 * h))}px` : "3px",
            backgroundColor: active ? `rgba(74,222,128,${0.5 + level * 0.5})` : "#3f3f46",
          }}
        />
      ))}
    </div>
  );
}

function RemoteVideo({ stream, username }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-zinc-700/50 bg-zinc-800 shadow-inner">
      <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/50 px-2 py-1 backdrop-blur-md">
        <span className="text-[10px] font-medium text-white">{username}</span>
      </div>
    </div>
  );
}

export default function VideoCall({
  onBack,
  roomName,
  sendVideoSignal,
  setVideoSignalListener,
}) {
  const { user } = useAuth();
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [hasPermissions, setHasPermissions] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [pipActive, setPipActive] = useState(false);
  // sessionId → { stream, username }
  const [remoteStreams, setRemoteStreams] = useState(new Map());

  const localVideoRef = useRef(null);
  const streamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const containerRef = useRef(null);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const audioDataRef = useRef(null);
  const rafRef = useRef(null);
  // sessionId → RTCPeerConnection
  const peersRef = useRef(new Map());
  // sessionId → username
  const peerNamesRef = useRef(new Map());
  // true once getUserMedia resolves
  const streamReadyRef = useRef(false);
  // video_join signals buffered before our stream is ready
  const pendingJoinsRef = useRef([]);

  // ── Audio analysis ────────────────────────────────────────────────────────

  const startAudioAnalysis = useCallback((stream) => {
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      audioDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(audioDataRef.current);
        const avg = audioDataRef.current.reduce((a, b) => a + b, 0) / audioDataRef.current.length;
        setAudioLevel(Math.min(avg / 60, 1));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (_) {}
  }, []);

  const stopAudioAnalysis = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setAudioLevel(0);
  }, []);

  // ── Peer connection helpers ───────────────────────────────────────────────

  const closePeer = useCallback((sessionId) => {
    const pc = peersRef.current.get(sessionId);
    if (pc) {
      pc.close();
      peersRef.current.delete(sessionId);
    }
    peerNamesRef.current.delete(sessionId);
    setRemoteStreams((prev) => {
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  const closeAllPeers = useCallback(() => {
    for (const pc of peersRef.current.values()) pc.close();
    peersRef.current.clear();
    peerNamesRef.current.clear();
    setRemoteStreams(new Map());
  }, []);

  const makePeer = useCallback((sessionId, username) => {
    if (peersRef.current.has(sessionId)) return peersRef.current.get(sessionId);

    peerNamesRef.current.set(sessionId, username);
    const pc = new RTCPeerConnection(ICE_SERVERS);

    // Add our local tracks so the remote receives our video/audio
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => pc.addTrack(t, streamRef.current));
    }

    // When remote sends their video/audio tracks
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      setRemoteStreams((prev) => {
        const next = new Map(prev);
        next.set(sessionId, { stream, username: peerNamesRef.current.get(sessionId) || username });
        return next;
      });
    };

    // Relay ICE candidates via the room WebSocket
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendVideoSignal?.({
          type: "video_ice_candidate",
          targetSessionId: sessionId,
          payload: event.candidate.toJSON(),
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
        closePeer(sessionId);
      }
    };

    peersRef.current.set(sessionId, pc);
    return pc;
  }, [sendVideoSignal, closePeer]);

  // ── Initiate offer (we're the existing peer, new peer joined) ────────────

  const initiateOffer = useCallback(async (sessionId, username) => {
    const pc = makePeer(sessionId, username);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendVideoSignal?.({
        type: "video_offer",
        targetSessionId: sessionId,
        payload: { type: offer.type, sdp: offer.sdp },
      });
    } catch (err) {
      console.error("[VideoCall] offer error:", err);
    }
  }, [makePeer, sendVideoSignal]);

  // ── Incoming WebRTC signal handler ────────────────────────────────────────

  useEffect(() => {
    if (!setVideoSignalListener) return;

    const handleSignal = async ({ type, fromSessionId, username, payload }) => {
      if (type === "video_join") {
        // New peer announced — send them an offer
        // If our stream isn't ready yet, buffer and process when it is
        if (!streamReadyRef.current) {
          pendingJoinsRef.current.push({ fromSessionId, username });
          return;
        }
        initiateOffer(fromSessionId, username);
        return;
      }

      if (type === "video_offer") {
        const pc = makePeer(fromSessionId, username || "Remote");
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendVideoSignal?.({
            type: "video_answer",
            targetSessionId: fromSessionId,
            payload: { type: answer.type, sdp: answer.sdp },
          });
        } catch (err) {
          console.error("[VideoCall] answer error:", err);
        }
        return;
      }

      if (type === "video_answer") {
        const pc = peersRef.current.get(fromSessionId);
        if (pc && pc.signalingState !== "stable") {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(payload));
          } catch (err) {
            console.error("[VideoCall] set answer error:", err);
          }
        }
        return;
      }

      if (type === "video_ice_candidate") {
        const pc = peersRef.current.get(fromSessionId);
        if (pc && payload) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload));
          } catch (_) {}
        }
        return;
      }

      if (type === "video_leave") {
        closePeer(fromSessionId);
      }
    };

    setVideoSignalListener(handleSignal);
    return () => setVideoSignalListener(null);
  }, [setVideoSignalListener, sendVideoSignal, makePeer, initiateOffer, closePeer]);

  // ── Media stream setup ────────────────────────────────────────────────────
  // FIX: `cancelled` flag prevents a stream that resolves after unmount from
  // staying alive with no cleanup — this was causing the camera to stay on.

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

        if (cancelled) {
          // Already unmounted — kill the stream immediately so camera turns off
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        streamReadyRef.current = true;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        setHasPermissions(true);
        startAudioAnalysis(stream);

        // Add tracks to any peer connections created before stream was ready
        for (const pc of peersRef.current.values()) {
          stream.getTracks().forEach((t) => {
            try { pc.addTrack(t, stream); } catch (_) {}
          });
        }

        // Process buffered video_join signals
        const pending = pendingJoinsRef.current.splice(0);
        for (const { fromSessionId, username } of pending) {
          initiateOffer(fromSessionId, username);
        }

        // Announce we've joined the call
        sendVideoSignal?.({ type: "video_join" });
      } catch (err) {
        if (!cancelled) {
          console.error("[VideoCall] getUserMedia error:", err);
          setHasPermissions(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      streamReadyRef.current = false;
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      stopAudioAnalysis();
      clearInterval(timerRef.current);
      closeAllPeers();
      sendVideoSignal?.({ type: "video_leave" });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // runs once

  // Call timer
  useEffect(() => {
    if (hasPermissions !== true) return;
    timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
    return () => clearInterval(timerRef.current);
  }, [hasPermissions]);

  // Fullscreen listener
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // PiP listener
  useEffect(() => {
    const video = localVideoRef.current;
    if (!video) return;
    const enter = () => setPipActive(true);
    const leave = () => setPipActive(false);
    video.addEventListener("enterpictureinpicture", enter);
    video.addEventListener("leavepictureinpicture", leave);
    return () => {
      video.removeEventListener("enterpictureinpicture", enter);
      video.removeEventListener("leavepictureinpicture", leave);
    };
  }, []);

  // ── Controls ──────────────────────────────────────────────────────────────

  const toggleAudio = () => {
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsAudioMuted((m) => !m);
  };

  const toggleVideo = () => {
    streamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsVideoMuted((m) => !m);
  };

  const endCall = () => {
    // Stop tracks immediately — camera indicator light turns off right away
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    streamReadyRef.current = false;
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    stopAudioAnalysis();
    clearInterval(timerRef.current);
    closeAllPeers();
    sendVideoSignal?.({ type: "video_leave" });
    setVideoSignalListener?.(null);
    onBack();
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      if (streamRef.current && localVideoRef.current) localVideoRef.current.srcObject = streamRef.current;
      setIsScreenSharing(false);
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = screen;
      if (localVideoRef.current) localVideoRef.current.srcObject = screen;
      setIsScreenSharing(true);
      screen.getVideoTracks()[0].onended = () => {
        screenStreamRef.current = null;
        if (streamRef.current && localVideoRef.current) localVideoRef.current.srcObject = streamRef.current;
        setIsScreenSharing(false);
      };
    } catch (err) {
      if (err.name !== "NotAllowedError") console.error("Screen share error:", err);
    }
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else {
      await containerRef.current?.requestFullscreen().catch(() => {});
    }
  };

  const togglePiP = async () => {
    if (!localVideoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await localVideoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.error("PiP error:", err);
    }
  };

  // ── Styles ────────────────────────────────────────────────────────────────

  const ctrlBtn = (active, danger = false) =>
    `flex h-11 w-11 items-center justify-center rounded-2xl transition-all shadow-sm ${
      danger
        ? "bg-red-500 text-white hover:bg-red-600 shadow-red-500/20"
        : active
          ? "bg-sky-500 text-white hover:bg-sky-600 shadow-sky-500/20"
          : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
    }`;

  const smBtn = (active) =>
    `flex h-8 w-8 items-center justify-center rounded-xl transition-all ${
      active
        ? "bg-violet-500/20 text-violet-400 ring-1 ring-violet-500/40"
        : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-300"
    }`;

  const remoteList = Array.from(remoteStreams.entries());
  const participantCount = 1 + remoteList.length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="flex h-full flex-col bg-zinc-50 dark:bg-[#09090b]">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200/80 px-4 py-3 dark:border-zinc-800 bg-white dark:bg-[#09090b]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={endCall}
            className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900 dark:hover:text-white"
            title="Leave call"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center justify-center rounded-md bg-sky-100 p-1.5 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400">
            <Video size={14} />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold leading-tight text-zinc-900 dark:text-white">Video Call</span>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{roomName}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasPermissions === true && (
            <div className="flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-900 px-2.5 py-1 text-xs font-mono font-medium text-zinc-600 dark:text-zinc-300">
              <Clock size={10} className="text-emerald-500" />
              {formatDuration(callDuration)}
            </div>
          )}
          <div className="flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            <Users size={12} />
            <span>{participantCount}</span>
          </div>
          <button type="button" onClick={toggleFullscreen} className={smBtn(isFullscreen)} title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Video Grid */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {hasPermissions === false ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-200/50 p-6 text-center dark:border-zinc-800 dark:bg-zinc-800/50">
            <VideoOff size={40} className="mb-3 text-zinc-400" />
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Camera / Mic Access Denied</p>
            <p className="mt-1 max-w-[200px] text-xs text-zinc-500">Please allow access in your browser to join the call.</p>
          </div>
        ) : (
          <>
            {/* Local video tile */}
            <div
              className={`group relative w-full aspect-[4/3] rounded-3xl overflow-hidden shadow-inner border transition-all ${
                isScreenSharing
                  ? "border-sky-500 ring-2 ring-sky-500/40 shadow-sky-900/30"
                  : "border-zinc-800/80 shadow-black/20"
              } bg-zinc-900`}
            >
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover transition-opacity duration-300 ${isVideoMuted ? "opacity-0" : "opacity-100"}`}
              />

              <div className={`absolute inset-0 flex items-center justify-center bg-zinc-800 transition-opacity duration-300 ${isVideoMuted ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                <div className="flex flex-col items-center gap-2">
                  <UserAvatar username={user?.username} size="xl" className="h-20 w-20 text-2xl shadow-xl shadow-black/20 ring-4 ring-zinc-900" />
                  <span className="rounded-full bg-zinc-950/60 px-3 py-1 text-sm font-medium text-zinc-300">Camera Off</span>
                </div>
              </div>

              {isScreenSharing && (
                <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-500/90 px-2.5 py-1 backdrop-blur-md">
                  <MonitorUp size={10} className="text-white" />
                  <span className="text-[10px] font-semibold text-white">Sharing</span>
                </div>
              )}

              {document.pictureInPictureEnabled && (
                <button
                  onClick={togglePiP}
                  className={`absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-full border px-2.5 py-1 backdrop-blur-md text-[10px] font-medium transition-opacity ${
                    pipActive
                      ? "border-violet-400/30 bg-violet-500/80 text-white opacity-100"
                      : "border-white/10 bg-black/50 text-white opacity-0 group-hover:opacity-100"
                  }`}
                  title={pipActive ? "Exit Picture-in-Picture" : "Picture-in-Picture"}
                >
                  <PictureInPicture2 size={10} />
                  {pipActive ? "PiP Active" : "PiP"}
                </button>
              )}

              <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-xl border border-white/10 bg-black/60 px-3 py-1.5 backdrop-blur-md">
                <span className="text-xs font-medium text-white">{user?.username || "You"}</span>
                {isAudioMuted
                  ? <MicOff size={10} className="text-red-400" />
                  : <AudioBars level={audioLevel} active={!isAudioMuted} />
                }
              </div>
            </div>

            {/* Remote participant tiles — real WebRTC streams */}
            {remoteList.map(([sessionId, { stream, username }]) => (
              <RemoteVideo key={sessionId} stream={stream} username={username} />
            ))}

            {remoteList.length === 0 && hasPermissions === true && (
              <div className="flex flex-col items-center justify-center p-4 text-center opacity-60">
                <Users size={22} className="mb-2 text-zinc-400" />
                <p className="text-xs text-zinc-500">Waiting for others to join…</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Control Bar */}
      <div className="relative z-10 flex items-center justify-center gap-3 border-t border-zinc-200/80 bg-white p-4 shadow-[0_-10px_20px_rgba(0,0,0,0.02)] dark:border-zinc-800 dark:bg-[#09090b]">
        <button onClick={toggleAudio} className={ctrlBtn(isAudioMuted, isAudioMuted)} title={isAudioMuted ? "Unmute" : "Mute"}>
          {isAudioMuted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <button onClick={toggleVideo} className={ctrlBtn(isVideoMuted, isVideoMuted)} title={isVideoMuted ? "Turn Camera On" : "Turn Camera Off"}>
          {isVideoMuted ? <VideoOff size={18} /> : <Video size={18} />}
        </button>
        <button onClick={toggleScreenShare} className={ctrlBtn(isScreenSharing)} title={isScreenSharing ? "Stop Sharing" : "Share Screen"}>
          <MonitorUp size={18} />
        </button>
        <button
          onClick={endCall}
          className="flex h-11 items-center justify-center rounded-2xl bg-red-500 px-6 font-semibold text-white shadow-sm shadow-red-500/20 transition-all hover:bg-red-600"
          title="End Call"
        >
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  );
}
