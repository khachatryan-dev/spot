"use client";

import { ArrowDown, ArrowUp, Pencil, Plus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useOptimisticValue } from "@/components/shared/use-optimistic-value";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRun } from "@/features/menu-editor/use-run";
import {
  MAX_TABLE_CAPACITY,
  TABLE_STATUSES,
  TABLE_TYPES,
  type TableStatus,
  type TableType,
} from "@/shared/constants/tables";

import {
  createTableAction,
  createTablesBulkAction,
  reorderTablesAction,
  updateTableAction,
} from "./actions";
import {
  type ActiveSessionInfo,
  ActiveSessionBadge,
} from "@/features/table-session/active-session-badge";

import { QrToolbar, type TableQrInfo, TableQrButton } from "./qr-controls";

export interface TableRow {
  id: string;
  number: string;
  name: string | null;
  capacity: number;
  zone: string | null;
  type: TableType;
  status: TableStatus;
  isActive: boolean;
  /** Only present for people who can manage QR codes; null = no code yet. */
  qr?: TableQrInfo | null;
  /** Open visit at this table, if any. */
  session?: ActiveSessionInfo | null;
}

const select =
  "h-8 rounded-lg border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function TablesManager({
  restaurantId,
  locationId,
  tables,
  canManage,
  canManageQr,
  canCloseSessions,
  canSeeBills,
}: {
  restaurantId: string;
  locationId: string;
  tables: TableRow[];
  canManage: boolean;
  canManageQr: boolean;
  canCloseSessions: boolean;
  canSeeBills: boolean;
}) {
  const t = useTranslations("Tables");
  const { busy, run } = useRun();
  const [editing, setEditing] = useState<TableRow | null>(null);

  function move(index: number, by: -1 | 1) {
    const ids = tables.map((x) => x.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    void run("move", () => reorderTablesAction(restaurantId, locationId, ids));
  }

  const activeTables = tables.filter((x) => x.isActive);
  return (
    <div className="flex flex-col gap-6">
      {canManageQr && activeTables.length > 0 && (
        <QrToolbar
          restaurantId={restaurantId}
          locationId={locationId}
          total={activeTables.length}
          missing={activeTables.filter((x) => !x.qr).length}
        />
      )}
      {tables.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border" aria-label={t("listLabel")}>
          {tables.map((table, index) => (
            <li key={table.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted font-semibold">
                  {table.number}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {table.name ?? t("tableN", { number: table.number })}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="size-3" aria-hidden />
                    {t("seats", { count: table.capacity })}
                    {table.zone && ` · ${table.zone}`}
                    {table.type !== "standard" && ` · ${t(`types.${table.type}`)}`}
                  </span>
                </div>
                {!table.isActive && <Badge variant="outline">{t("inactive")}</Badge>}
              </div>
              <div className="basis-full empty:hidden sm:basis-auto">
                {table.session && (
                  <ActiveSessionBadge
                    restaurantId={restaurantId}
                    tableNumber={table.number}
                    session={table.session}
                    canClose={canCloseSessions}
                    canSeeBill={canSeeBills}
                  />
                )}
              </div>
              <StatusSelect
                restaurantId={restaurantId}
                table={table}
                disabled={!canManage || busy !== null}
                run={run}
              />
              {canManageQr && table.isActive && (
                <TableQrButton
                  restaurantId={restaurantId}
                  tableId={table.id}
                  number={table.number}
                  qr={table.qr ?? null}
                />
              )}
              {canManage && (
                <div className="flex">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("moveUp", { number: table.number })}
                    disabled={busy !== null || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("moveDown", { number: table.number })}
                    disabled={busy !== null || index === tables.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("edit", { number: table.number })}
                    onClick={() => setEditing(table)}
                  >
                    <Pencil aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="grid gap-4 md:grid-cols-2">
          <AddTableForm restaurantId={restaurantId} locationId={locationId} />
          <BulkAddForm restaurantId={restaurantId} locationId={locationId} />
        </div>
      )}

      {editing && (
        <EditDialog restaurantId={restaurantId} table={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function StatusSelect({
  restaurantId,
  table,
  disabled,
  run,
}: {
  restaurantId: string;
  table: TableRow;
  disabled: boolean;
  run: ReturnType<typeof useRun>["run"];
}) {
  const t = useTranslations("Tables");
  const [status, setStatus, reset] = useOptimisticValue(table.status);
  return (
    <select
      aria-label={t("statusFor", { number: table.number })}
      className={select}
      value={status}
      disabled={disabled}
      onChange={async (e) => {
        const next = e.target.value as TableStatus;
        setStatus(next);
        if (
          !(await run(table.id, () => updateTableAction(restaurantId, table.id, { status: next })))
        )
          reset();
      }}
    >
      {TABLE_STATUSES.map((s) => (
        <option key={s} value={s}>
          {t(`statuses.${s}`)}
        </option>
      ))}
    </select>
  );
}

function AddTableForm({ restaurantId, locationId }: { restaurantId: string; locationId: string }) {
  const t = useTranslations("Tables");
  const { busy, run } = useRun();
  const [number, setNumber] = useState("");
  const [capacity, setCapacity] = useState("4");
  const [zone, setZone] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const done = await run("add", () =>
      createTableAction(restaurantId, { locationId, number, capacity: Number(capacity), zone }),
    );
    if (done) setNumber("");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="font-medium">{t("addTitle")}</h2>
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {t("number")}
          <Input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={20} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("capacity")}
          <Input
            type="number"
            min={1}
            max={MAX_TABLE_CAPACITY}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("zone")}
          <Input value={zone} onChange={(e) => setZone(e.target.value)} maxLength={60} />
        </label>
      </div>
      <Button
        type="submit"
        variant="outline"
        className="self-start"
        disabled={busy !== null || number.trim() === ""}
      >
        <Plus aria-hidden />
        {t("add")}
      </Button>
    </form>
  );
}

function BulkAddForm({ restaurantId, locationId }: { restaurantId: string; locationId: string }) {
  const t = useTranslations("Tables");
  const { busy, run } = useRun();
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("10");
  const [capacity, setCapacity] = useState("4");

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await run("bulk", () =>
          createTablesBulkAction(restaurantId, {
            locationId,
            from: Number(from),
            to: Number(to),
            capacity: Number(capacity),
          }),
        );
        if (result) setFrom(String(Number(to) + 1));
      }}
    >
      <h2 className="font-medium">{t("bulkTitle")}</h2>
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {t("from")}
          <Input type="number" min={1} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("to")}
          <Input type="number" min={1} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("capacity")}
          <Input
            type="number"
            min={1}
            max={MAX_TABLE_CAPACITY}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </label>
      </div>
      <Button
        type="submit"
        variant="outline"
        className="self-start"
        disabled={busy !== null || !(Number(to) >= Number(from))}
      >
        <Plus aria-hidden />
        {t("bulkAdd", { from: Number(from) || 0, to: Number(to) || 0 })}
      </Button>
    </form>
  );
}

function EditDialog({
  restaurantId,
  table,
  onClose,
}: {
  restaurantId: string;
  table: TableRow;
  onClose: () => void;
}) {
  const t = useTranslations("Tables");
  const { busy, run } = useRun();
  const [form, setForm] = useState({
    number: table.number,
    name: table.name ?? "",
    capacity: String(table.capacity),
    zone: table.zone ?? "",
    type: table.type,
    isActive: table.isActive,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm({ ...form, [key]: value });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editTitle", { number: table.number })}</DialogTitle>
        </DialogHeader>
        <form
          id="edit-table"
          className="grid grid-cols-2 gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const done = await run(
              table.id,
              () =>
                updateTableAction(restaurantId, table.id, {
                  ...form,
                  capacity: Number(form.capacity),
                }),
              t("saved"),
            );
            if (done) onClose();
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {t("number")}
            <Input
              value={form.number}
              onChange={(e) => set("number", e.target.value)}
              maxLength={20}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("capacity")}
            <Input
              type="number"
              min={1}
              max={MAX_TABLE_CAPACITY}
              value={form.capacity}
              onChange={(e) => set("capacity", e.target.value)}
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm">
            {t("name")}
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={60} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("zone")}
            <Input value={form.zone} onChange={(e) => set("zone", e.target.value)} maxLength={60} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("type")}
            <select
              className={select}
              value={form.type}
              onChange={(e) => set("type", e.target.value as TableType)}
            >
              {TABLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={form.isActive}
              onChange={(e) => set("isActive", e.target.checked)}
            />
            {t("active")}
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            form="edit-table"
            disabled={busy !== null || form.number.trim() === ""}
          >
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
