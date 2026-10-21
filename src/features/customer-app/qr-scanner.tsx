"use client";

import { Camera, CameraOff, ImageUp, Loader2, ScanLine, Zap, ZapOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clientEnv } from "@/shared/config/env.client";
import { tablePathFromScan } from "@/shared/domain/qr-link";

type State = "starting" | "scanning" | "blocked" | "wrong" | "opening";

/** The browser's own QR detector (Chrome on Android); not in TypeScript's DOM types yet. */
type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorClass = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};

/** A QR reader: the native detector when there is one, else jsQR (loaded only here). */
/** What we read codes from: live camera frames, or a photo the guest picked. */
type Source = HTMLVideoElement | ImageBitmap;

async function createReader(): Promise<(source: Source) => Promise<string | null>> {
  const Native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (Native && (await Native.getSupportedFormats()).includes("qr_code")) {
    const detector = new Native({ formats: ["qr_code"] });
    return async (source) => (await detector.detect(source))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  return async (source) => {
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (!width || !height) return null;
    // Small frames decode fast and are plenty for a table card.
    const scale = Math.min(1, 640 / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height)?.data ?? null;
  };
}

/**
 * Scan a table's QR code inside the app, like a banking app's pay screen:
 * live camera with a frame and a torch button. If the camera can't be used,
 * guests take or pick a photo of the code instead.
 */
export function QrScanner() {
  const t = useTranslations("CustomerApp.scanner");
  const video = useRef<HTMLVideoElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const reader = useRef<Awaited<ReturnType<typeof createReader>> | null>(null);
  const [state, setState] = useState<State>("starting");
  const [torch, setTorch] = useState<boolean | null>(null);

  /** Open the table if the text is one of our table links; otherwise say so. */
  function open(text: string | null): boolean {
    if (!text) return false;
    const path = tablePathFromScan(text, [window.location.origin, clientEnv.NEXT_PUBLIC_APP_URL]);
    if (!path) {
      setState("wrong");
      return false;
    }
    setState("opening");
    // /t/<token> is a route handler that sets the table cookie: a full navigation.
    window.location.assign(path);
    return true;
  }

  // The camera loop calls this without restarting when state changes.
  const handle = useEffectEvent(open);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stream: MediaStream | null = null;

    async function start() {
      try {
        reader.current = await createReader();
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (stopped) return;
        const element = video.current!;
        element.srcObject = stream;
        await element.play();
        track.current = stream.getVideoTracks()[0] ?? null;
        const capabilities = track.current?.getCapabilities?.() ?? {};
        setTorch("torch" in capabilities ? false : null);
        setState("scanning");
        const tick = async () => {
          if (stopped) return;
          const found = handle(await reader.current!(element).catch(() => null));
          if (!found) timer = setTimeout(tick, 250);
        };
        void tick();
      } catch {
        if (!stopped) setState("blocked");
      }
    }
    void start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function toggleTorch() {
    if (!track.current || torch === null) return;
    const next = !torch;
    await track.current
      .applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] })
      .then(() => setTorch(next))
      .catch(() => setTorch(null));
  }

  async function readPhoto(file: File | undefined) {
    if (!file) return;
    reader.current ??= await createReader();
    const bitmap = await createImageBitmap(file).catch(() => null);
    const text = bitmap ? await reader.current(bitmap).catch(() => null) : null;
    if (!open(text)) setState("wrong");
  }

  const live = state === "scanning" || state === "wrong";

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-neutral-900 shadow-lg">
        <video
          ref={video}
          muted
          playsInline
          aria-label={t("cameraLabel")}
          className={cn("size-full object-cover", !live && "invisible")}
        />
        {/* Frame with corner marks */}
        <div aria-hidden className="pointer-events-none absolute inset-[15%]">
          {[
            "top-0 left-0 border-t-4 border-l-4 rounded-tl-2xl",
            "top-0 right-0 border-t-4 border-r-4 rounded-tr-2xl",
            "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-2xl",
            "bottom-0 right-0 border-b-4 border-r-4 rounded-br-2xl",
          ].map((corner) => (
            <span key={corner} className={cn("absolute size-10 border-orange-500", corner)} />
          ))}
          {state === "scanning" && (
            <ScanLine className="absolute inset-x-0 top-1/2 mx-auto size-12 -translate-y-1/2 text-orange-500/70" />
          )}
        </div>
        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-white">
            {state === "blocked" ? (
              <>
                <CameraOff className="size-10" aria-hidden />
                <p className="text-sm">{t("blocked")}</p>
              </>
            ) : (
              <>
                <Loader2 className="size-10 animate-spin" aria-hidden />
                <p className="text-sm">{t(state === "opening" ? "opening" : "starting")}</p>
              </>
            )}
          </div>
        )}
        {torch !== null && live && (
          <Button
            type="button"
            size="icon-lg"
            variant="secondary"
            className="absolute right-3 bottom-3 rounded-full"
            aria-pressed={torch}
            aria-label={t(torch ? "torchOff" : "torchOn")}
            onClick={toggleTorch}
          >
            {torch ? <ZapOff aria-hidden /> : <Zap aria-hidden />}
          </Button>
        )}
      </div>

      <p role="status" className="text-center text-sm font-medium">
        {state === "wrong" ? (
          <span className="text-destructive">{t("wrong")}</span>
        ) : state === "scanning" ? (
          <span className="inline-flex items-center gap-1.5">
            <Camera className="size-4" aria-hidden />
            {t("hint")}
          </span>
        ) : null}
      </p>

      <input
        ref={photo}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void readPhoto(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-11 rounded-xl"
        onClick={() => photo.current?.click()}
      >
        <ImageUp aria-hidden />
        {t("photo")}
      </Button>
    </div>
  );
}
