"use client";

import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useApiError } from "@/components/shared/use-api-error";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { ApiResult } from "@/shared/errors";

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Upload / replace / remove one image via an upload endpoint (POST multipart,
 * DELETE). Client checks are for fast feedback; the server re-validates.
 */
export function ImageUploader({
  id,
  endpoint,
  label,
  url,
  readOnly,
  shape,
}: {
  /** Unique per page; used for the hidden file input. */
  id: string;
  endpoint: string;
  label: string;
  url: string | null;
  readOnly: boolean;
  shape: "square" | "wide";
}) {
  const t = useTranslations("Images");
  const apiError = useApiError();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function send(init: RequestInit) {
    setBusy(true);
    try {
      const response = await fetch(endpoint, init);
      const result = (await response.json()) as ApiResult<unknown>;
      if (result.error) {
        const field = result.error.fieldErrors?.file?.[0];
        toast.error(
          field === "imageTooLarge" || field === "imageInvalid"
            ? t(field)
            : apiError.message(result.error),
        );
        return;
      }
      router.refresh();
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    // Fast feedback only; the server checks the real file content.
    if (!ACCEPT.split(",").includes(file.type)) return void toast.error(t("imageInvalid"));
    if (file.size > MAX_BYTES) return void toast.error(t("imageTooLarge"));
    const body = new FormData();
    body.set("file", file);
    void send({ method: "POST", body });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-xl border bg-muted/40",
          shape === "square" ? "size-28" : "aspect-[16/9] w-full max-w-md",
        )}
      >
        {url ? (
          <Image src={url} alt={label} fill unoptimized className="object-cover" sizes="448px" />
        ) : (
          <ImagePlus className="size-8 text-muted-foreground" aria-hidden />
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 className="animate-spin" aria-label={t("uploading")} />
          </div>
        )}
      </div>
      {!readOnly && (
        <div className="flex gap-2">
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            id={`upload-${id}`}
            // The button below is the control; the input only opens the picker.
            tabIndex={-1}
            aria-label={url ? t("replace", { label }) : t("upload", { label })}
            disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => input.current?.click()}
            aria-label={url ? t("replace", { label }) : t("upload", { label })}
          >
            {url ? t("replaceShort") : t("uploadShort")}
          </Button>
          {url && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={t("remove", { label })}
              onClick={() => send({ method: "DELETE" })}
            >
              <Trash2 aria-hidden />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
