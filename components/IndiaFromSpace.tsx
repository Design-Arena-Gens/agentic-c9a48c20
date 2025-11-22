"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { Map } from "maplibre-gl";

function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function buildGibsUrl(dateStr: string): string {
  // NASA GIBS VIIRS True Color, GoogleMapsCompatible schema up to z=9
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${dateStr}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
}

export default function IndiaFromSpace() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const [isAnimating, setAnimating] = useState(false);
  const [isRecording, setRecording] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [fps, setFps] = useState<number>(30);
  const [days, setDays] = useState<number>(30);

  const dates = useMemo(() => {
    // Safeguard: GIBS occasionally lags; avoid "today" by starting 2 days back
    const list: string[] = [];
    for (let i = days + 1; i >= 2; i--) {
      list.push(formatDate(daysAgo(i)));
    }
    return list;
  }, [days]);

  const ensureMap = useCallback((initialDate: string) => {
    if (mapRef.current || !containerRef.current) return;

    const centerIndia: [number, number] = [78.9629, 22.5937]; // lng, lat

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: centerIndia,
      zoom: 4.4,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          gibs: {
            type: "raster",
            tiles: [buildGibsUrl(initialDate)],
            tileSize: 256,
            attribution:
              "Imagery: NASA GIBS / VIIRS (Corrected Reflectance True Color)",
          },
        },
        layers: [
          {
            id: "gibs-layer",
            type: "raster",
            source: "gibs",
            paint: { "raster-opacity": 1 },
          },
        ],
      },
      interactive: true,
      preserveDrawingBuffer: true, // required for clean captureStream frames
    });

    mapRef.current = map;
  }, []);

  useEffect(() => {
    const initial = dates[0] ?? formatDate(daysAgo(3));
    ensureMap(initial);
  }, [dates, ensureMap]);

  const updateDateTiles = useCallback((dateStr: string) => {
    const map = mapRef.current;
    if (!map) return;

    if (map.getLayer("gibs-layer")) {
      map.removeLayer("gibs-layer");
    }
    if (map.getSource("gibs")) {
      map.removeSource("gibs");
    }

    map.addSource("gibs", {
      type: "raster",
      tiles: [buildGibsUrl(dateStr)],
      tileSize: 256,
      attribution: "Imagery: NASA GIBS / VIIRS",
    } as any);

    map.addLayer({ id: "gibs-layer", type: "raster", source: "gibs" });
  }, []);

  const animateDates = useCallback(
    async (opts: { onFrame?: (i: number, total: number) => void } = {}) => {
      if (dates.length === 0) return;
      setAnimating(true);
      setStatus("Animating frames...");
      for (let i = 0; i < dates.length; i++) {
        if (!isAnimating && !isRecording) break;
        const dateStr = dates[i];
        updateDateTiles(dateStr);
        opts.onFrame?.(i, dates.length);
        // Wait for tiles to load sufficiently
        await new Promise<void>((resolve) => {
          const map = mapRef.current;
          if (!map) return resolve();
          const onIdle = () => {
            map.off("idle", onIdle);
            resolve();
          };
          map.on("idle", onIdle);
          // Fallback timeout in case idle isn't triggered
          setTimeout(() => {
            map.off("idle", onIdle);
            resolve();
          }, 1500);
        });
        // Frame pacing according to FPS
        const frameDelay = Math.max(0, Math.round(1000 / fps) - 4);
        await new Promise((r) => setTimeout(r, frameDelay));
      }
      setAnimating(false);
      setStatus("");
    },
    [dates, fps, updateDateTiles, isAnimating, isRecording]
  );

  const startRecording = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;

    const stream = map.getCanvas().captureStream(fps);
    recordedChunksRef.current = [];

    const mimeTypes = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];

    let mime: string | undefined = undefined;
    for (const m of mimeTypes) {
      if (MediaRecorder.isTypeSupported(m)) {
        mime = m;
        break;
      }
    }

    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    recorderRef.current = recorder;
    setRecording(true);
    setStatus("Recording...");

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
    };

    const stopPromise = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    recorder.start(Math.max(1, Math.round(1000 / fps)));

    await animateDates({
      onFrame: (i, total) => {
        setStatus(`Recording frame ${i + 1} / ${total}`);
      },
    });

    recorder.stop();
    await stopPromise;
    setRecording(false);
    setStatus("Finalizing video...");

    const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `india-from-space-${timestamp}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
    setStatus("Video ready. You can re-record or adjust settings.");
  }, [animateDates, fps]);

  const stopAll = useCallback(() => {
    setAnimating(false);
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    setRecording(false);
    setStatus("");
  }, []);

  const currentPreviewDate = dates[0] ?? formatDate(daysAgo(3));

  return (
    <div className="card">
      <div className="header">
        <h1>India from Space ? Time?lapse</h1>
        <div className="status">
          <span className="badge">Source: NASA GIBS ? VIIRS True Color</span>
        </div>
      </div>

      <div className="controls">
        <label>
          Days:
          <input
            type="number"
            min={7}
            max={120}
            step={1}
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value || "30", 10))}
            style={{ width: 80, marginLeft: 6 }}
          />
        </label>
        <label>
          FPS:
          <input
            type="number"
            min={5}
            max={60}
            step={1}
            value={fps}
            onChange={(e) => setFps(parseInt(e.target.value || "30", 10))}
            style={{ width: 80, marginLeft: 6 }}
          />
        </label>
        <button disabled={isAnimating || isRecording} onClick={() => animateDates()}>Play preview</button>
        <button disabled={isRecording} onClick={startRecording}>Record video</button>
        <button className="danger" onClick={stopAll}>Stop</button>
        <span className="status">{status || `Preview date: ${currentPreviewDate}`}</span>
      </div>

      <div className="mapWrap">
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      </div>

      <div className="footer">
        <span className="status">Tip: Recording will iterate dates and export a .webm file.</span>
        <a className="link" href="https://wiki.earthdata.nasa.gov/display/GIBS" target="_blank" rel="noreferrer">About NASA GIBS</a>
      </div>
    </div>
  );
}
