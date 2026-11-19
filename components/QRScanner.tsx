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

function stopCameraSession(session: CameraSession) {
  const stream = session.stream
    ?? (session.video.srcObject instanceof MediaStream ? session.video.srcObject : null);
  session.controls?.stop();
  for (const track of stream?.getTracks() ?? []) track.stop();
  if (stream && session.video.srcObject === stream) {
    session.video.pause();
    session.video.srcObject = null;
  }
  session.controls = null;
  session.stream = null;
}

function cameraErrorMessage(error: unknown) {
  const errorName = error instanceof Error ? error.name : "";
  const errorMessage = error instanceof Error ? error.message : "";
  const secureLocalhost = window.location.hostname === "localhost"
    || window.location.hostname === "127.0.0.1"
    || window.location.hostname === "[::1]";

  if (!window.isSecureContext && !secureLocalhost) {
    return "Camera access requires HTTPS. Open this site on localhost or its HTTPS deployment.";
  }
  if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(errorName)) {
    return "Camera permission was denied. Allow camera access in your browser settings, then start the camera again.";
  }
  if (["NotFoundError", "DevicesNotFoundError"].includes(errorName)) {
    return "No camera was found. Connect a camera or use manual token entry below.";
  }
  if (["NotReadableError", "TrackStartError", "AbortError"].includes(errorName)) {
    return "The camera could not be opened. It may be in use by another app; close that app and try again.";
  }
  if (errorName === "OverconstrainedError") {
    return "That camera is unavailable. Select another camera or use manual token entry.";
  }
  if (errorMessage) return `Could not start the camera: ${errorMessage}`;
  return "Could not start the camera. Use manual token entry below or try another device.";
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
    setHasScanned(false);
    lockedRef.current = false;
    lastScannedRef.current = null;
  }, []);

  const startCamera = useCallback((requestedDeviceId = selectedDeviceId) => {
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
    setHasScanned(false);
    lockedRef.current = false;
    lastScannedRef.current = null;

    const start = async () => {
      try {
        if (!window.isSecureContext && !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
          throw new Error("Camera access requires a secure context.");
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This browser does not support camera access.");
        }

        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromVideoDevice(
          requestedDeviceId || undefined,
          video,
          (result, error) => {
            if (sessionRef.current !== session || session.cancelled || generationRef.current !== generation) return;
            if (error && !["NotFoundException", "ChecksumException", "FormatException"].includes(error.name)) {
              session.failed = true;
              session.controls?.stop();
              if (sessionRef.current === session) sessionRef.current = null;
              setCameraReady(false);
              setCameraStarting(false);
              setCameraError(`Camera scanning stopped: ${error.message || "an unexpected decoding error occurred."}`);
              return;
            }
            if (!result) {
              const last = lastScannedRef.current;
              if (last && Date.now() - last.lastSeenAt > 1200) lastScannedRef.current = null;
              return;
            }

            const value = result.getText();
            const last = lastScannedRef.current;
            if (last?.value === value) {
              last.lastSeenAt = Date.now();
              return;
            }
            if (lockedRef.current) return;

            lastScannedRef.current = { value, lastSeenAt: Date.now() };
            lockedRef.current = true;
            setHasScanned(true);
            onScanRef.current(value);
          },
        );
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

        setCameraReady(true);
        const activeDeviceId = session.stream?.getVideoTracks()[0]?.getSettings().deviceId;
        if (activeDeviceId) setSelectedDeviceId(activeDeviceId);
        try {
          const devices = await BrowserCodeReader.listVideoInputDevices();
          if (sessionRef.current === session && generationRef.current === generation) {
            setCameraDevices(devices);
            if (!activeDeviceId && requestedDeviceId && devices.some((device) => device.deviceId === requestedDeviceId)) {
              setSelectedDeviceId(requestedDeviceId);
            }
          }
        } catch (error) {
          if (sessionRef.current === session && generationRef.current === generation) {
            const detail = error instanceof Error ? error.message : "device enumeration failed.";
            setDeviceError(`Camera is active, but available cameras could not be listed: ${detail}`);
          }
        }
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
  }, [active, selectedDeviceId]);

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
        <video ref={videoRef} className="scanner-video" aria-label="Live QR scanner camera" muted playsInline />
        {!cameraReady && (
          <div className="scanner-overlay">
            {cameraError ? <CameraOff size={30} /> : <Camera size={30} />}
            <strong>{cameraError ? "Camera unavailable" : cameraStarting ? "Starting camera" : "Camera stopped"}</strong>
            <span>{cameraError || (cameraStarting ? "Waiting for camera permission and video." : "Start the camera to scan an attendee QR pass.")}</span>
          </div>
        )}
        {cameraReady && <div className="scan-target"><span /></div>}
        <div className="scanner-tag"><span className="live-dot" /> {cameraReady ? "LIVE SCANNER" : "SCANNER READY"}</div>
      </div>
      <div className="scanner-actions">
        <div className="scanner-hint">
          {cameraReady ? <Camera size={15} /> : <CameraOff size={15} />}
          {cameraReady ? "Camera active" : cameraPending ? "Waiting for camera request to finish" : "Camera stopped"}
        </div>
        <div className="scanner-action-buttons">
          {cameraDevices.length > 1 && (
            <select
              className="button button-secondary button-small"
              aria-label="Select camera"
              value={selectedDeviceId}
              disabled={!cameraReady || cameraPending}
              onChange={(event) => switchCamera(event.target.value)}
            >
              {cameraDevices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          )}
          {cameraReady || cameraStarting ? (
            <button className="button button-secondary button-small" type="button" onClick={stopCamera}>
              <CameraOff size={15} /> Stop Camera
            </button>
          ) : (
            <button
              className="button button-primary button-small"
              type="button"
              onClick={() => startCamera()}
              disabled={!active || cameraPending}
            >
              <Camera size={15} /> {cameraPending ? "Starting…" : "Start Camera"}
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
      {hasScanned && <p className="scanner-hint"><CheckCircle2 size={15} /> Pass captured. Review the result, then scan the next pass.</p>}
      {cameraPending && !cameraStarting && <p className="scanner-hint">The current camera request is still finishing. Start is available when it has released its stream.</p>}
      <div className="manual-divider"><span>OR ENTER CODE MANUALLY</span></div>
      <form className="manual-form" onSubmit={submitManual}>
        <div className="input-with-icon"><Keyboard size={17} /><input value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="Paste pass URL or token" disabled={!active} /></div>
        <button className="button button-secondary" type="submit" disabled={!active || !manualCode.trim() || hasScanned}>Submit</button>
      </form>
    </div>
  );
}
