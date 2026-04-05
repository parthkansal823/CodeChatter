import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  LayoutGrid,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  PanelRightClose,
  PanelRightOpen,
  PhoneOff,
  PictureInPicture2,
  Radio,
  Users,
  Video,
  VideoOff,
} from "lucide-react";

import { useAuth } from "../hooks/useAuth";
import UserAvatar from "./UserAvatar";
import { logActivity } from "./ActivityLog";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function AudioBars({ level, active }) {
  const heights = [0.55, 1, 0.7];
  return (
    <div className="flex h-3 items-end gap-[2px]">
      {heights.map((height, index) => (
        <div
          key={index}
          className="w-[3px] rounded-full transition-all duration-100"
          style={{
            height: active ? `${Math.max(3, Math.round(level * 12 * height))}px` : "3px",
            backgroundColor: active ? `rgba(74,222,128,${0.45 + level * 0.5})` : "#52525b",
          }}
        />
      ))}
    </div>
  );
}

function VideoTile({
  stream,
  username,
  subtitle,
  muted = false,
  isLocal = false,
  isVideoMuted = false,
  isScreenSharing = false,
  audioLevel = 0,
  size = "main",
  videoRefOverride = null,
}) {
  const internalVideoRef = useRef(null);
  const videoRef = videoRefOverride || internalVideoRef;

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream || null;
    }
  }, [stream]);

  const sizeClasses = size === "thumb"
    ? "aspect-[4/3] rounded-2xl"
    : "aspect-[4/3] rounded-[28px]";

  return (
    <div className={`group relative overflow-hidden border border-white/10 bg-zinc-950 shadow-[0_20px_50px_rgba(0,0,0,0.35)] ${sizeClasses}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full object-cover transition-opacity duration-300 ${isVideoMuted ? "opacity-0" : "opacity-100"}`}
      />

      <div className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 transition-opacity duration-300 ${isVideoMuted ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <div className="flex flex-col items-center gap-3">
          <UserAvatar username={username} size="xl" className="h-20 w-20 text-2xl shadow-xl shadow-black/30 ring-4 ring-black/40" />
          <span className="rounded-full border border-white/10 bg-black/45 px-3 py-1 text-sm font-medium text-white">
            Camera off
          </span>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />

      {isScreenSharing ? (
        <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-500/85 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-md">
          <MonitorUp size={10} />
          Presenting
        </div>
      ) : null}

      <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
        <div className="rounded-2xl border border-white/10 bg-black/45 px-3 py-2 backdrop-blur-md">
          <p className="truncate text-xs font-semibold text-white">{username}</p>
          {subtitle ? <p className="mt-0.5 text-[10px] text-zinc-300">{subtitle}</p> : null}
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/45 px-2.5 py-2 backdrop-blur-md">
          {isLocal && muted ? <MicOff size={13} className="text-rose-400" /> : <AudioBars level={audioLevel} active={!muted} />}
        </div>
      </div>
    </div>
  );
}

export default function VideoCall({
  onBack,
  roomId,
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
  const [layout, setLayout] = useState("stage");
  const [participantsOpen, setParticipantsOpen] = useState(true);
  const [copied, setCopied] = useState(false);
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
  const peersRef = useRef(new Map());
  const peerNamesRef = useRef(new Map());
  const streamReadyRef = useRef(false);
  const pendingJoinsRef = useRef([]);

  const remoteList = useMemo(() => Array.from(remoteStreams.entries()), [remoteStreams]);
  const participantCount = 1 + remoteList.length;
  const primaryRemote = remoteList[0] || null;
  const secondaryRemotes = primaryRemote ? remoteList.slice(1) : remoteList;

  const startAudioAnalysis = useCallback((stream) => {
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      context.createMediaStreamSource(stream).connect(analyser);
      audioCtxRef.current = context;
      analyserRef.current = analyser;
      audioDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current || !audioDataRef.current) return;
        analyserRef.current.getByteFrequencyData(audioDataRef.current);
        const average = audioDataRef.current.reduce((acc, value) => acc + value, 0) / audioDataRef.current.length;
        setAudioLevel(Math.min(average / 60, 1));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // AudioContext is optional here.
    }
  }, []);

  const stopAudioAnalysis = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setAudioLevel(0);
  }, []);

  const closePeer = useCallback((sessionId) => {
    const peer = peersRef.current.get(sessionId);
    if (peer) {
      peer.close();
      peersRef.current.delete(sessionId);
    }
    peerNamesRef.current.delete(sessionId);
    setRemoteStreams((previous) => {
      const next = new Map(previous);
      next.delete(sessionId);
      return next;
    });
  }, []);

  const closeAllPeers = useCallback(() => {
    for (const peer of peersRef.current.values()) {
      peer.close();
    }
    peersRef.current.clear();
    peerNamesRef.current.clear();
    setRemoteStreams(new Map());
  }, []);

  const replaceOutgoingVideoTrack = useCallback(async (track) => {
    const replacements = [];
    for (const peer of peersRef.current.values()) {
      const sender = peer.getSenders().find((entry) => entry.track?.kind === "video");
      if (sender) {
        replacements.push(sender.replaceTrack(track));
      }
    }
    await Promise.allSettled(replacements);
  }, []);

  const restoreCameraFeed = useCallback(async () => {
    const cameraTrack = streamRef.current?.getVideoTracks?.()[0] || null;
    if (cameraTrack) {
      await replaceOutgoingVideoTrack(cameraTrack);
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = streamRef.current;
    }
  }, [replaceOutgoingVideoTrack]);

  const makePeer = useCallback((sessionId, username) => {
    if (peersRef.current.has(sessionId)) {
      return peersRef.current.get(sessionId);
    }

    peerNamesRef.current.set(sessionId, username);
    const peer = new RTCPeerConnection(ICE_SERVERS);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => peer.addTrack(track, streamRef.current));
    }

    peer.ontrack = (event) => {
      const [stream] = event.streams;
      setRemoteStreams((previous) => {
        const next = new Map(previous);
        next.set(sessionId, {
          stream,
          username: peerNamesRef.current.get(sessionId) || username || "Guest",
        });
        return next;
      });
    };

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        sendVideoSignal?.({
          type: "video_ice_candidate",
          targetSessionId: sessionId,
          payload: event.candidate.toJSON(),
        });
      }
    };

    peer.oniceconnectionstatechange = () => {
      if (peer.iceConnectionState === "failed" || peer.iceConnectionState === "closed") {
        closePeer(sessionId);
      }
    };

    peersRef.current.set(sessionId, peer);
    return peer;
  }, [closePeer, sendVideoSignal]);

  const initiateOffer = useCallback(async (sessionId, username) => {
    const peer = makePeer(sessionId, username);
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      sendVideoSignal?.({
        type: "video_offer",
        targetSessionId: sessionId,
        payload: { type: offer.type, sdp: offer.sdp },
      });
    } catch (error) {
      console.error("[VideoCall] offer error:", error);
    }
  }, [makePeer, sendVideoSignal]);

  useEffect(() => {
    if (!setVideoSignalListener) return undefined;

    const handleSignal = async ({ type, fromSessionId, username, payload }) => {
      if (type === "video_join") {
        if (!streamReadyRef.current) {
          pendingJoinsRef.current.push({ fromSessionId, username });
          return;
        }
        initiateOffer(fromSessionId, username);
        return;
      }

      if (type === "video_offer") {
        const peer = makePeer(fromSessionId, username || "Guest");
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(payload));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          sendVideoSignal?.({
            type: "video_answer",
            targetSessionId: fromSessionId,
            payload: { type: answer.type, sdp: answer.sdp },
          });
        } catch (error) {
          console.error("[VideoCall] answer error:", error);
        }
        return;
      }

      if (type === "video_answer") {
        const peer = peersRef.current.get(fromSessionId);
        if (peer && peer.signalingState !== "stable") {
          try {
            await peer.setRemoteDescription(new RTCSessionDescription(payload));
          } catch (error) {
            console.error("[VideoCall] set answer error:", error);
          }
        }
        return;
      }

      if (type === "video_ice_candidate") {
        const peer = peersRef.current.get(fromSessionId);
        if (peer && payload) {
          try {
            await peer.addIceCandidate(new RTCIceCandidate(payload));
          } catch {
            // Ignore failed candidate additions during reconnects.
          }
        }
        return;
      }

      if (type === "video_leave") {
        closePeer(fromSessionId);
      }
    };

    setVideoSignalListener(handleSignal);
    return () => setVideoSignalListener(null);
  }, [closePeer, initiateOffer, makePeer, sendVideoSignal, setVideoSignalListener]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        streamReadyRef.current = true;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        setHasPermissions(true);
        startAudioAnalysis(stream);
        logActivity(roomId, "meeting_event", `Joined video call in ${roomName || "workspace"}`);

        for (const peer of peersRef.current.values()) {
          stream.getTracks().forEach((track) => {
            try {
              peer.addTrack(track, stream);
            } catch {
              // Track may already exist after reconnect.
            }
          });
        }

        const pending = pendingJoinsRef.current.splice(0);
        for (const { fromSessionId, username } of pending) {
          initiateOffer(fromSessionId, username);
        }

        sendVideoSignal?.({ type: "video_join" });
      } catch (error) {
        if (!cancelled) {
          console.error("[VideoCall] getUserMedia error:", error);
          setHasPermissions(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      streamReadyRef.current = false;
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      stopAudioAnalysis();
      clearInterval(timerRef.current);
      closeAllPeers();
      sendVideoSignal?.({ type: "video_leave" });
    };
  }, [closeAllPeers, initiateOffer, roomId, roomName, sendVideoSignal, startAudioAnalysis, stopAudioAnalysis]);

  useEffect(() => {
    if (hasPermissions !== true) return undefined;
    timerRef.current = setInterval(() => setCallDuration((value) => value + 1), 1000);
    return () => clearInterval(timerRef.current);
  }, [hasPermissions]);

  useEffect(() => {
    const handleFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFullscreen);
    return () => document.removeEventListener("fullscreenchange", handleFullscreen);
  }, []);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video) return undefined;
    const enter = () => setPipActive(true);
    const leave = () => setPipActive(false);
    video.addEventListener("enterpictureinpicture", enter);
    video.addEventListener("leavepictureinpicture", leave);
    return () => {
      video.removeEventListener("enterpictureinpicture", enter);
      video.removeEventListener("leavepictureinpicture", leave);
    };
  }, []);

  const toggleAudio = () => {
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !track.enabled;
    });
    setIsAudioMuted((value) => !value);
  };

  const toggleVideo = () => {
    streamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !track.enabled;
    });
    setIsVideoMuted((value) => !value);
  };

  const endCall = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    streamReadyRef.current = false;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    stopAudioAnalysis();
    clearInterval(timerRef.current);
    closeAllPeers();
    sendVideoSignal?.({ type: "video_leave" });
    setVideoSignalListener?.(null);
    logActivity(roomId, "meeting_event", `Left video call in ${roomName || "workspace"}`);
    onBack();
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      await restoreCameraFeed();
      setIsScreenSharing(false);
      logActivity(roomId, "meeting_event", "Stopped presenting");
      return;
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack = screenStream.getVideoTracks()[0];
      screenStreamRef.current = screenStream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = screenStream;
      }
      await replaceOutgoingVideoTrack(screenTrack);
      setIsScreenSharing(true);
      logActivity(roomId, "meeting_event", "Started presenting screen");

      screenTrack.onended = async () => {
        screenStreamRef.current = null;
        await restoreCameraFeed();
        setIsScreenSharing(false);
      };
    } catch (error) {
      if (error.name !== "NotAllowedError") {
        console.error("[VideoCall] screen share error:", error);
      }
    }
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else {
      await containerRef.current?.requestFullscreen?.().catch(() => {});
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
    } catch (error) {
      console.error("[VideoCall] pip error:", error);
    }
  };

  const copyMeetingLabel = async () => {
    try {
      await navigator.clipboard.writeText(roomName || "Workspace call");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard issues.
    }
  };

  const controlButton = (active, danger = false) =>
    `flex h-12 w-12 items-center justify-center rounded-2xl border transition ${
      danger
        ? "border-red-400/30 bg-red-500 text-white shadow-[0_10px_25px_rgba(239,68,68,0.35)] hover:bg-red-400"
        : active
          ? "border-sky-400/30 bg-sky-500 text-white shadow-[0_10px_25px_rgba(14,165,233,0.35)] hover:bg-sky-400"
          : "border-white/8 bg-white/[0.05] text-zinc-200 hover:bg-white/[0.09]"
    }`;

  const headerButton = (active = false) =>
    `flex h-9 w-9 items-center justify-center rounded-xl border transition ${
      active
        ? "border-sky-400/30 bg-sky-500/15 text-sky-300"
        : "border-white/8 bg-white/[0.04] text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100"
    }`;

  return (
    <div ref={containerRef} className="flex h-full flex-col bg-[#08090d] text-white">
      <div className="border-b border-white/[0.06] bg-[#0c0d12] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={endCall}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/8 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
              title="Leave call"
            >
              <ArrowLeft size={15} />
            </button>

            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-400">
              <Video size={17} />
            </div>

            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">Video Call</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                <span className="truncate">{roomName || "Workspace call"}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                  <Radio size={10} />
                  Live
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasPermissions === true ? (
              <div className="hidden items-center gap-1 rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300 sm:flex">
                <Clock size={11} className="text-emerald-400" />
                {formatDuration(callDuration)}
              </div>
            ) : null}

            <div className="hidden items-center gap-1 rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300 sm:flex">
              <Users size={11} />
              {participantCount}
            </div>

            <button onClick={copyMeetingLabel} className={headerButton(copied)} title="Copy meeting label">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <button onClick={() => setLayout((value) => value === "stage" ? "grid" : "stage")} className={headerButton(layout === "grid")} title="Toggle layout">
              <LayoutGrid size={14} />
            </button>
            <button onClick={() => setParticipantsOpen((value) => !value)} className={headerButton(participantsOpen)} title="Toggle participants">
              {participantsOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            </button>
            <button onClick={toggleFullscreen} className={headerButton(isFullscreen)} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {hasPermissions === false ? (
              <div className="flex h-full items-center justify-center">
                <div className="w-full max-w-sm rounded-[28px] border border-rose-500/20 bg-rose-500/10 p-6 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/20 text-rose-300">
                    <VideoOff size={22} />
                  </div>
                  <p className="mt-4 text-lg font-semibold text-white">Camera or mic blocked</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    Allow browser access to join the meeting. Once permission is granted, the room will connect automatically.
                  </p>
                </div>
              </div>
            ) : remoteList.length === 0 ? (
              <div className="space-y-4">
                <VideoTile
                  stream={screenStreamRef.current || streamRef.current}
                  username={user?.username || "You"}
                  subtitle={isScreenSharing ? "Presenting to the room" : "Your preview"}
                  muted
                  isLocal
                  isVideoMuted={isVideoMuted}
                  isScreenSharing={isScreenSharing}
                  audioLevel={audioLevel}
                  videoRefOverride={localVideoRef}
                />

                <div className="rounded-[28px] border border-white/8 bg-gradient-to-br from-white/[0.05] via-white/[0.03] to-sky-500/10 p-5">
                  <p className="text-lg font-semibold text-white">Meeting is ready</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    This call now behaves more like a real meeting room: you can present, pin yourself in PiP, switch layouts, and watch participants join live.
                  </p>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {[
                      { label: "Participants", value: `${participantCount}` },
                      { label: "Layout", value: layout === "stage" ? "Meet stage" : "Grid" },
                      { label: "Presenting", value: isScreenSharing ? "Yes" : "No" },
                    ].map((item) => (
                      <div key={item.label} className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3">
                        <p className="text-[11px] text-zinc-400">{item.label}</p>
                        <p className="mt-1 text-sm font-semibold text-white">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : layout === "grid" ? (
              <div className="grid grid-cols-1 gap-3">
                <VideoTile
                  stream={screenStreamRef.current || streamRef.current}
                  username={user?.username || "You"}
                  subtitle="You"
                  muted
                  isLocal
                  isVideoMuted={isVideoMuted}
                  isScreenSharing={isScreenSharing}
                  audioLevel={audioLevel}
                  size="thumb"
                  videoRefOverride={localVideoRef}
                />
                {remoteList.map(([sessionId, { stream, username }]) => (
                  <VideoTile
                    key={sessionId}
                    stream={stream}
                    username={username}
                    subtitle="Connected"
                    size="thumb"
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {primaryRemote ? (
                  <div className="relative">
                    <VideoTile
                      stream={primaryRemote[1].stream}
                      username={primaryRemote[1].username}
                      subtitle="Active speaker"
                    />

                    <div className="absolute bottom-3 right-3 w-[34%] min-w-[120px] max-w-[170px]">
                      <VideoTile
                        stream={screenStreamRef.current || streamRef.current}
                        username={user?.username || "You"}
                        subtitle={isScreenSharing ? "Presenting" : "You"}
                        muted
                        isLocal
                        isVideoMuted={isVideoMuted}
                        isScreenSharing={isScreenSharing}
                        audioLevel={audioLevel}
                        size="thumb"
                        videoRefOverride={localVideoRef}
                      />
                    </div>
                  </div>
                ) : null}

                {secondaryRemotes.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3">
                    {secondaryRemotes.map(([sessionId, { stream, username }]) => (
                      <VideoTile
                        key={sessionId}
                        stream={stream}
                        username={username}
                        subtitle="Connected"
                        size="thumb"
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="border-t border-white/[0.06] bg-[#0c0d12] px-4 py-4">
            <div className="flex items-center justify-center gap-3">
              <button onClick={toggleAudio} className={controlButton(isAudioMuted, isAudioMuted)} title={isAudioMuted ? "Unmute" : "Mute"}>
                {isAudioMuted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              <button onClick={toggleVideo} className={controlButton(isVideoMuted, isVideoMuted)} title={isVideoMuted ? "Turn camera on" : "Turn camera off"}>
                {isVideoMuted ? <VideoOff size={18} /> : <Video size={18} />}
              </button>
              <button onClick={toggleScreenShare} className={controlButton(isScreenSharing)} title={isScreenSharing ? "Stop presenting" : "Present now"}>
                <MonitorUp size={18} />
              </button>
              {document.pictureInPictureEnabled ? (
                <button onClick={togglePiP} className={controlButton(pipActive)} title={pipActive ? "Exit PiP" : "Picture in picture"}>
                  <PictureInPicture2 size={18} />
                </button>
              ) : null}
              <button onClick={endCall} className="inline-flex h-12 items-center gap-2 rounded-2xl border border-red-400/30 bg-red-500 px-5 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(239,68,68,0.35)] transition hover:bg-red-400" title="End call">
                <PhoneOff size={18} />
                Leave
              </button>
            </div>
          </div>
        </div>

        {participantsOpen ? (
          <aside className="hidden w-[220px] shrink-0 border-l border-white/[0.06] bg-[#0c0d12] xl:flex xl:flex-col">
            <div className="border-b border-white/[0.06] px-4 py-3">
              <p className="text-sm font-semibold text-white">Participants</p>
              <p className="mt-1 text-xs text-zinc-400">{participantCount} in this workspace call</p>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
              <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-3 py-3">
                <div className="flex items-center gap-3">
                  <UserAvatar username={user?.username} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{user?.username || "You"}</p>
                    <p className="text-[11px] text-sky-200">{isScreenSharing ? "Presenting" : "Local"}</p>
                  </div>
                  {isAudioMuted ? <MicOff size={13} className="text-rose-400" /> : <Mic size={13} className="text-emerald-400" />}
                </div>
              </div>

              {remoteList.map(([sessionId, { username }]) => (
                <div key={sessionId} className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
                  <div className="flex items-center gap-3">
                    <UserAvatar username={username} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{username}</p>
                      <p className="text-[11px] text-zinc-400">Connected</p>
                    </div>
                    <Radio size={12} className="text-emerald-400" />
                  </div>
                </div>
              ))}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
