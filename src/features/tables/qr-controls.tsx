"use client";

import { Printer, QrCode, RefreshCw } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRun } from "@/features/menu-editor/use-run";
import { Link } from "@/i18n/navigation";

import {
  ensureLocationQrAction,
  ensureTableQrAction,
  revokeTableQrAction,
  rotateTableQrAction,
} from "./qr-actions";

export interface TableQrInfo {
  url: string;
  image: string;
}

/** Location-wide QR actions: create missing codes, open the print sheet. */
export function QrToolbar({
  restaurantId,
  locationId,
  missing,
  total,
}: {
  restaurantId: string;
  locationId: string;
  missing: number;
  total: number;
}) {
  const t = useTranslations("Tables.qr");
  const { busy, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-3">
      <QrCode className="size-5 text-muted-foreground" aria-hidden />
      <span className="flex-1 text-sm">
        {missing > 0 ? t("missing", { count: missing }) : t("allReady")}
      </span>
      {missing > 0 && (
        <Button
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            run("all", () => ensureLocationQrAction(restaurantId, locationId), t("created"))
          }
        >
          {t("createAll")}
        </Button>
      )}
      {total - missing > 0 && (
        <Button
          size="sm"
          variant="outline"
          render={
            <Link href={`/dashboard/r/${restaurantId}/tables/print?location=${locationId}`} />
          }
        >
          <Printer aria-hidden />
          {t("print")}
        </Button>
      )}
    </div>
  );
}

/** Per-table QR button: shows the code, or creates one; rotate and revoke inside. */
export function TableQrButton({
  restaurantId,
  tableId,
  number,
  qr,
}: {
  restaurantId: string;
  tableId: string;
  number: string;
  qr: TableQrInfo | null;
}) {
  const t = useTranslations("Tables.qr");
  const { busy, run } = useRun();
  const [open, setOpen] = useState(false);

  if (!qr) {
    return (
      <Button
        size="sm"
        variant="outline"
        aria-label={t("createFor", { number })}
        disabled={busy !== null}
        onClick={() => run(tableId, () => ensureTableQrAction(restaurantId, tableId))}
      >
        <QrCode aria-hidden />
        {t("create")}
      </Button>
    );
  }

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        aria-label={t("showFor", { number })}
        onClick={() => setOpen(true)}
      >
        <QrCode aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title", { number })}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <Image
              src={qr.image}
              alt={t("imageAlt", { number })}
              width={240}
              height={240}
              unoptimized
              className="rounded-lg border bg-white p-2"
            />
            <code
              className="max-w-full text-center text-xs break-all text-muted-foreground"
              data-testid="qr-url"
            >
              {qr.url}
            </code>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={async () => {
                if (!window.confirm(t("revokeConfirm", { number }))) return;
                if (
                  await run(tableId, () => revokeTableQrAction(restaurantId, tableId), t("revoked"))
                )
                  setOpen(false);
              }}
            >
              {t("revoke")}
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm(t("rotateConfirm", { number }))) {
                  void run(tableId, () => rotateTableQrAction(restaurantId, tableId), t("rotated"));
                }
              }}
            >
              <RefreshCw aria-hidden />
              {t("rotate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
