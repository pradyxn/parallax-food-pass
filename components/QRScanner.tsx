"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { BrowserCodeReader, BrowserQRCodeReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { Camera, CameraOff, CheckCircle2, Keyboard } from "lucide-react";

type Props = {
  active: boolean;
  onScan: (value: string) => void;
};

type CameraSession = {
  video: HTMLVideoElement;
  controls: IScannerControls | null;
  stream: MediaStream | null;
  cancelled: boolean;
  failed: boolean;
};

const TRANSIENT_DECODE_ERRORS = new Set([
  "NotFoundException",
  "ChecksumException",
  "FormatException",
]);

function stopCameraSession(session: CameraSession) {
  const stream = session.stream
    ?? (session.video.srcObject instanceof MediaStream ? session.video.srcObject : null);

  try {
    session.controls?.stop();
  } catch {
    // Stop every media track below even if the scanner control has already stopped.
  }

  for (const track of stream?.getTracks() ?? []) {
    try {
      track.stop();
    } catch {
      // A track may already have been released by the browser.
    }
  }

  if (stream && session.video.srcObject === stream) {
    session.video.pause();
    session.video.srcObject = null;
  }

  session.controls = null;
  session.stream = null;
}

function isCameraConstraintError(error: unknown) {
  return error instanceof Error
    && ["OverconstrainedError", "ConstraintNotSatisfiedError", "NotFoundError"].includes(error.name);
}

function isRearCameraLabel(label: string) {
  return /\b(back|rear|environment|world|outward)\b/i.test(label);
}

function cameraErrorMessage(error: unknown) {
  const errorName = error instanceof Error ? error.name : "";
  const errorMessage = error instanceof Error ? error.message : "";
  const secureLocalhost = window.location.hostname === "localhost"
    || window.location.hostname === "127.0.0.1"
    || window.location.hostname === "[::1]";

  if (!window.isSecureContext && !secureLocalhost) {
    return "Camera access requires HTTPS. Open the Parallax site using its secure https:// address.";
  }
  if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(errorName)) {
    return "Camera permission is blocked. Allow camera access for this site in your phone browser settings, then reload and tap Start rear camera.";
  }
  if (["NotFoundError", "DevicesNotFoundError"].includes(errorName)) {
    return "No usable camera was found. Check that your phone has a rear camera and that no other app is using it.";
  }
  if (["NotReadableError", "TrackStartError", "AbortError"].includes(errorName)) {
    return "The camera is busy or unavailable. Close the Camera app and other browser tabs using it, then try again.";
  }
  if (errorName === "OverconstrainedError" || errorName === "ConstraintNotSatisfiedError") {
    return "The phone could not open its rear camera. Check camera permissions and try again.";
  }
  if (/media devices|mediaDevices|getUserMedia/i.test(errorMessage)) {
    return "This browser does not provide camera access. Open Parallax in Safari on iPhone or Chrome on Android, not inside another app.";
  }
  if (errorMessage) return "Could not start the rear camera: " + errorMessage;
  return "Could not start the rear camera. Check browser camera permission and try again.";
}

export default function QRScanner({ active, onScan }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<CameraSession | null>(null);
  const startPendingRef = useRef(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const lockedRef = useRef(false);
  const lastScannedRef = useRef<{ value: string; lastSeenAt: number } | null>(null);
  const onScanRef = useRef(onScan);

  const [cameraError, setCameraError] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraPending, setCameraPending] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [cameraLabel, setCameraLabel] = useState("REAR CAMERA");
  const [hasScanned, setHasScanned] = useState(false);

  onScanRef.current = onScan;

  const stopCamera = useCallback(() => {
    generationRef.current += 1;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      session.cancelled = true;
      stopCameraSession(session);
    }
    setCameraReady(false);
    setCameraStarting(false);
    setCameraError("");
    setCameraLabel("REAR CAMERA");
    setHasScanned(false);
    lockedRef.current = false;
    lastScannedRef.current = null;
  }, []);

  const startCamera = useCallback((requestedDeviceId?: string) => {
    const video = videoRef.current;
    if (!active || !video || startPendingRef.current || sessionRef.current) return;

    const generation = ++generationRef.current;
    const session: CameraSession = {
      video,
      controls: null,
      stream: null,
      cancelled: false,
      failed: false,
    };

    sessionRef.current = session;
    startPendingRef.current = true;
    setCameraPending(true);
    setCameraStarting(true);
    setCameraReady(false);
    setCameraError("");
    setDeviceError("");
    setCameraLabel(requestedDeviceId ? "SELECTED CAMERA" : "REQUESTING REAR CAMERA");
    setHasScanned(false);
    lockedRef.current = false;
    lastScannedRef.current = null;

    const handleDecode = (result: { getText(): string } | undefined, error?: { name: string; message?: string }) => {
      if (sessionRef.current !== session || session.cancelled || generationRef.current !== generation) return;

      if (error && !TRANSIENT_DECODE_ERRORS.has(error.name)) {
        session.failed = true;
        stopCameraSession(session);
        if (sessionRef.current === session) sessionRef.current = null;
        setCameraReady(false);
        setCameraStarting(false);
        setCameraError("QR scanning stopped: " + (error.message || "the camera decoder encountered an unexpected error."));
        return;
      }

      if (!result) {
        const last = lastScannedRef.current;
        if (last && Date.now() - last.lastSeenAt > 1200) lastScannedRef.current = null;
        return;
      }

      const value = result.getText().trim();
      if (!value) return;

      const last = lastScannedRef.current;
      if (last?.value === value) {
        last.lastSeenAt = Date.now();
        return;
      }
      if (lockedRef.current) return;

      lastScannedRef.current = { value, lastSeenAt: Date.now() };
      lockedRef.current = true;
      setHasScanned(true);
      if ("vibrate" in navigator) navigator.vibrate?.(80);
      onScanRef.current(value);
    };

    const start = async () => {
      try {
        const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
        if (!window.isSecureContext && !localHost) {
          throw new Error("Camera requires a secure HTTPS page.");
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This browser does not support mediaDevices.getUserMedia.");
        }

        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "true");
        video.setAttribute("webkit-playsinline", "true");

        const reader = new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 220,
          delayBetweenScanSuccess: 450,
          tryPlayVideoTimeout: 12000,
        });

        const qualityConstraints: MediaTrackConstraints = {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 },
        };

        const openWithConstraints = (videoConstraints: MediaTrackConstraints) =>
          reader.decodeFromConstraints(
            { audio: false, video: videoConstraints },
            video,
            handleDecode,
          );

        let controls: IScannerControls;
        if (requestedDeviceId) {
          controls = await openWithConstraints({
            ...qualityConstraints,
            deviceId: { exact: requestedDeviceId },
          });
        } else {
          try {
            controls = await openWithConstraints({
              ...qualityConstraints,
              facingMode: { exact: "environment" },
            });
          } catch (error) {
            // Some mobile browsers reject an exact facingMode constraint even when
            // they can still select the rear camera as their ideal device.
            if (!isCameraConstraintError(error)) throw error;
            controls = await openWithConstraints({
              ...qualityConstraints,
              facingMode: { ideal: "environment" },
            });
          }
        }

        session.controls = controls;
        session.stream = video.srcObject instanceof MediaStream ? video.srcObject : null;

        if (
          session.cancelled
          || session.failed
          || sessionRef.current !== session
          || generationRef.current !== generation
        ) {
          stopCameraSession(session);
          return;
        }

        const activeTrack = session.stream?.getVideoTracks()[0];
        const activeSettings = activeTrack?.getSettings();
        const activeDeviceId = activeSettings?.deviceId || requestedDeviceId || "";
        setCameraReady(true);
        setSelectedDeviceId(activeDeviceId);
        if (activeSettings?.facingMode === "environment") {
          setCameraLabel("BACK CAMERA LIVE");
        } else if (activeSettings?.facingMode === "user") {
          setCameraLabel("FRONT CAMERA SELECTED");
        } else {
          setCameraLabel(requestedDeviceId ? "SELECTED CAMERA LIVE" : "CAMERA LIVE");
        }

        try {
          const devices = await BrowserCodeReader.listVideoInputDevices();
          if (sessionRef.current === session && generationRef.current === generation) {
            const orderedDevices = [...devices].sort((a, b) => {
              return Number(isRearCameraLabel(b.label)) - Number(isRearCameraLabel(a.label));
            });
            setCameraDevices(orderedDevices);

            const activeDevice = orderedDevices.find((device) => device.deviceId === activeDeviceId);
            if (activeSettings?.facingMode !== "user" && isRearCameraLabel(activeDevice?.label ?? "")) {
              setCameraLabel("BACK CAMERA LIVE");
            }
            if (!activeDeviceId && orderedDevices.length > 0) {
              const rearDevice = orderedDevices.find((device) => isRearCameraLabel(device.label));
              if (rearDevice) setSelectedDeviceId(rearDevice.deviceId);
            }
          }
        } catch (error) {
          if (sessionRef.current === session && generationRef.current === generation) {
            const detail = error instanceof Error ? error.message : "device enumeration failed.";
            setDeviceError("Camera is active, but the phone did not provide camera names: " + detail);
          }
        }

        activeTrack?.addEventListener("ended", () => {
          if (sessionRef.current !== session || session.cancelled) return;
          stopCameraSession(session);
          sessionRef.current = null;
          setCameraReady(false);
          setCameraStarting(false);
          setCameraError("The camera was disconnected. Tap Start rear camera to reconnect.");
        }, { once: true });
      } catch (error) {
        const isCurrentSession = sessionRef.current === session && generationRef.current === generation;
        stopCameraSession(session);
        if (isCurrentSession && mountedRef.current) {
          sessionRef.current = null;
          setCameraReady(false);
          setCameraError(cameraErrorMessage(error));
        }
      } finally {
        startPendingRef.current = false;
        if (mountedRef.current) {
          setCameraPending(false);
          setCameraStarting(false);
        }
      }
    };

    void start();
  }, [active]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) {
        session.cancelled = true;
        stopCameraSession(session);
      }
    };
  }, []);

  useEffect(() => {
    if (!active) stopCamera();
  }, [active, stopCamera]);

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    const value = manualCode.trim();
    if (!active || !value || lockedRef.current) return;
    lockedRef.current = true;
    lastScannedRef.current = { value, lastSeenAt: Date.now() };
    setHasScanned(true);
    onScanRef.current(value);
    setManualCode("");
  };

  const scanNext = () => {
    lockedRef.current = false;
    setHasScanned(false);
  };

  const switchCamera = (deviceId: string) => {
    if (!deviceId || deviceId === selectedDeviceId || !cameraReady || cameraPending) return;
    stopCamera();
    setSelectedDeviceId(deviceId);
    startCamera(deviceId);
  };

  return (
    <div className="scanner-stack">
      <div className="scanner-frame">
        <video
          ref={videoRef}
          className="scanner-video"
          aria-label="Live rear camera QR scanner"
          autoPlay
          muted
          playsInline
          disablePictureInPicture
        />
        {!cameraReady && (
          <div className="scanner-overlay">
            {cameraError ? <CameraOff size={30} /> : <Camera size={30} />}
            <strong>{cameraError ? "Camera unavailable" : cameraStarting ? "Starting rear camera" : "Rear camera stopped"}</strong>
            <span>{cameraError || (cameraStarting ? "Allow camera access in your phone browser." : "Tap Start rear camera to scan Parallax attendee passes.")}</span>
          </div>
        )}
        {cameraReady && <div className="scan-target"><span /></div>}
        <div className="scanner-tag"><span className="live-dot" /> {cameraReady ? cameraLabel : "REAR CAMERA SCANNER"}</div>
      </div>
      <div className="scanner-actions">
        <div className="scanner-hint">
          {cameraReady ? <Camera size={15} /> : <CameraOff size={15} />}
          {cameraReady ? cameraLabel.toLowerCase() : cameraPending ? "Waiting for camera permission" : "Rear camera is stopped"}
        </div>
        <div className="scanner-action-buttons">
          {cameraDevices.length > 1 && (
            <select
              className="button button-secondary button-small"
              aria-label="Select phone camera"
              value={selectedDeviceId}
              disabled={!cameraReady || cameraPending}
              onChange={(event) => switchCamera(event.target.value)}
            >
              {cameraDevices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || ("Camera " + (index + 1))}
                </option>
              ))}
            </select>
          )}
          {cameraReady || cameraStarting ? (
            <button className="button button-secondary button-small" type="button" onClick={stopCamera}>
              <CameraOff size={15} /> Stop camera
            </button>
          ) : (
            <button
              className="button button-primary button-small"
              type="button"
              onClick={() => startCamera()}
              disabled={!active || cameraPending}
            >
              <Camera size={15} /> {cameraPending ? "Starting…" : "Start rear camera"}
            </button>
          )}
          {hasScanned && (
            <button className="button button-secondary button-small" type="button" onClick={scanNext}>
              <CheckCircle2 size={15} /> Scan next pass
            </button>
          )}
        </div>
      </div>
      {cameraError && <p className="error-inline" role="alert">{cameraError}</p>}
      {deviceError && <p className="error-inline" role="status">{deviceError}</p>}
      {hasScanned && <p className="scanner-hint"><CheckCircle2 size={15} /> Code captured. Review the server verification result, then scan the next pass.</p>}
      {cameraPending && !cameraStarting && <p className="scanner-hint">The previous camera request is still finishing. Try again when it has released the camera.</p>}
      <div className="manual-divider"><span>OR ENTER PASS URL / TOKEN</span></div>
      <form className="manual-form" onSubmit={submitManual}>
        <div className="input-with-icon"><Keyboard size={17} /><input value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="Paste a Parallax pass URL or token" disabled={!active} autoCapitalize="off" autoCorrect="off" /></div>
        <button className="button button-secondary" type="submit" disabled={!active || !manualCode.trim() || hasScanned}>Submit</button>
      </form>
    </div>
  );
}
