"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Hls from "hls.js";

type Props = {
  src: string;
  channelName: string;
};

export function VideoPlayer({ src, channelName }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [inPip, setInPip] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);

  const destroy = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    destroy();

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(src);
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    }

    return () => {
      const v = videoRef.current;
      if (v && document.pictureInPictureElement === v) {
        document.exitPictureInPicture().catch(() => {});
      }
      destroy();
    };
  }, [src, destroy]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {});
  }, [src]);

  /** Picture-in-Picture: browser may auto-pop-out when tab is hidden; manual toggle as fallback. */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const canPip =
      typeof document !== "undefined" &&
      "pictureInPictureEnabled" in document &&
      document.pictureInPictureEnabled !== false &&
      typeof video.requestPictureInPicture === "function";
    setPipSupported(!!canPip);

    const onEnterPip = () => setInPip(true);
    const onLeavePip = () => setInPip(false);
    video.addEventListener("enterpictureinpicture", onEnterPip);
    video.addEventListener("leavepictureinpicture", onLeavePip);

    try {
      const v = video as HTMLVideoElement & { autoPictureInPicture?: boolean };
      if ("autoPictureInPicture" in video) {
        v.autoPictureInPicture = true;
      }
    } catch {
      /* ignore */
    }

    const tryPipWhenHidden = async () => {
      if (!document.hidden) return;
      const el = videoRef.current;
      if (!el || document.pictureInPictureElement === el) return;
      if (el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      try {
        await el.requestPictureInPicture();
      } catch {
        /* Often blocked without prior user gesture — use the PiP button */
      }
    };

    document.addEventListener("visibilitychange", tryPipWhenHidden);

    return () => {
      document.removeEventListener("visibilitychange", tryPipWhenHidden);
      video.removeEventListener("enterpictureinpicture", onEnterPip);
      video.removeEventListener("leavepictureinpicture", onLeavePip);
      try {
        const v = video as HTMLVideoElement & { autoPictureInPicture?: boolean };
        if ("autoPictureInPicture" in video) {
          v.autoPictureInPicture = false;
        }
      } catch {
        /* ignore */
      }
    };
  }, []);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled !== false) {
        await video.requestPictureInPicture();
      }
    } catch {
      /* unsupported or denied */
    }
  }, []);

  return (
    <div className="player-shell">
      {pipSupported ? (
        <button
          type="button"
          className="pip-toggle"
          onClick={togglePip}
          aria-pressed={inPip}
          title={inPip ? "Close picture-in-picture" : "Picture-in-picture (stays on top when you switch tabs)"}
          aria-label={inPip ? "Exit picture-in-picture" : "Enter picture-in-picture"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
            <rect x="2" y="4" width="14" height="12" rx="1.5" strokeWidth="1.75" />
            <rect x="10" y="10" width="12" height="10" rx="1.5" strokeWidth="1.75" />
          </svg>
          <span className="pip-toggle-text">{inPip ? "Exit PiP" : "PiP"}</span>
        </button>
      ) : null}
      <video
        ref={videoRef}
        className="video-el"
        controls
        playsInline
        autoPlay
        muted={false}
        disablePictureInPicture={false}
        aria-label={`Live stream: ${channelName}`}
      />
    </div>
  );
}
