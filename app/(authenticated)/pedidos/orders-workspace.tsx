"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  cancelSupplierOrder,
  cancelSupplierOrderRemaining,
  createSupplierOrder,
  markSupplierOrderAllPicked,
  setSupplierOrderItemPickedQuantity,
  updateSupplierOrder,
} from "@/app/(authenticated)/pedidos/actions";
import { CommercialConfigurationImage } from "@/components/commercial-configuration-image";
import { CompatibleKitImages } from "@/components/compatible-kit-images";
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  OrdersIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/icons";
import { getServoFamilyLabel } from "@/lib/inventory-family";
import type { CompatibleKitImageOption } from "@/lib/compatible-kit-images";
import type {
  CreateSupplierOrderInput,
  SupplierOrderCatalogConfiguration,
  SupplierOrderCatalogPhysicalItem,
  SupplierOrderEvent,
  SupplierOrderItem,
  SupplierOrderLineInput,
  SupplierOrdersData,
  SupplierOrderStatus,
  SupplierOrderSummary,
  UpdateSupplierOrderInput,
} from "@/lib/supplier-orders-types";

type SupplierOrdersWorkspaceProps = {
  data: SupplierOrdersData;
};

type StatusFilter = "ALL" | SupplierOrderStatus;
type PeriodFilter = "ALL" | "7" | "30" | "90" | "MONTH";
type OrderSort = "RECENT" | "OLDEST" | "NUMBER";
type ConfirmationKind = "MARK_ALL" | "CANCEL" | "CANCEL_REMAINING";
type CatalogGroup =
  | "CONFIGURATIONS"
  | "SERVO"
  | "INSTALLATION_KIT"
  | "REPAIR_KIT"
  | "LOOSE_PART";

type DraftLine = {
  localId: string;
  existingId: string | null;
  kind: "ITEM" | "COMMERCIAL_CONFIGURATION";
  itemId: string | null;
  configurationId: string | null;
  commercialCodeId: string | null;
  code: string;
  description: string;
  imageUrl: string | null;
  compatibleKitImages: CompatibleKitImageOption[];
  model: string | null;
  typeLabel: string;
  quantity: number;
  notes: string;
  pickedQuantity: number;
  stockedQuantity: number;
  cancelledQuantity: number;
  identityLocked: boolean;
};

const maximumInteger = 2_147_483_647;
const quantityFormatter = new Intl.NumberFormat("pt-BR");

const statusDetails: Record<
  SupplierOrderStatus,
  { label: string; className: string }
> = {
  PENDING: {
    label: "Pendente",
    className: "border-amber-200 bg-amber-50 text-amber-950",
  },
  PARTIAL: {
    label: "Parcial",
    className: "border-sky-200 bg-sky-50 text-sky-950",
  },
  COMPLETED: {
    label: "Concluído",
    className: "border-emerald-200 bg-emerald-50 text-emerald-950",
  },
  CANCELLED: {
    label: "Cancelado",
    className: "border-red-200 bg-red-50 text-red-900",
  },
};

const orderItemTypeLabels = {
  SERVO: "Servoembreagem",
  INSTALLATION_KIT: "Kit de instalação",
  REPAIR_KIT: "Jogo de reparo",
  LOOSE_PART: "Peça avulsa",
} as const;

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function OrderItemImageButton({
  code,
  compatibleKitImages,
  imageUrl,
}: {
  code: string;
  compatibleKitImages: CompatibleKitImageOption[];
  imageUrl: string | null;
}) {
  if (compatibleKitImages.length > 0) {
    return (
      <CompatibleKitImages
        kitCode={code}
        options={compatibleKitImages}
      />
    );
  }

  if (!imageUrl) {
    return null;
  }

  return (
    <CommercialConfigurationImage
      commercialCodes={[code]}
      imageUrl={imageUrl}
      triggerVariant="icon-button"
    />
  );
}

function ItemQuantityIndicators({
  orderedQuantity,
  pickedQuantity,
  waitingPickupQuantity,
}: {
  orderedQuantity: number;
  pickedQuantity: number;
  waitingPickupQuantity: number;
}) {
  const indicators = [
    {
      label: "Solicitado",
      value: orderedQuantity,
      className: "border-slate-200 bg-slate-50 text-text-primary",
    },
    {
      label: "Retirado",
      value: pickedQuantity,
      className: "border-emerald-200 bg-emerald-50 text-emerald-950",
    },
    {
      label: "Falta",
      value: waitingPickupQuantity,
      className: "border-amber-200 bg-amber-50 text-amber-950",
    },
  ];

  return (
    <dl
      className="grid min-w-0 grid-cols-3 gap-1"
      aria-label="Resumo das quantidades do item"
    >
      {indicators.map((indicator) => (
        <div
          key={indicator.label}
          className={`min-w-0 rounded-lg border px-1.5 py-1 ${indicator.className}`}
        >
          <dt className="truncate text-[0.52rem] leading-3 font-black tracking-wide uppercase sm:text-[0.58rem]">
            {indicator.label}
          </dt>
          <dd className="font-mono text-sm leading-4 font-black sm:text-base sm:leading-5">
            {quantityFormatter.format(indicator.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function formatOrderDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatCompactOrderDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day
    ? `${day}/${month}/${year.slice(-2)}`
    : value;
}

function getLocalDateInputValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function compareText(first: string, second: string) {
  return first.localeCompare(second, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

function lineIdentity(line: DraftLine) {
  return line.kind === "ITEM"
    ? `ITEM:${line.itemId}`
    : `CONFIGURATION:${line.configurationId}:${line.commercialCodeId ?? "NONE"}`;
}

function itemTypeLabel(itemType: SupplierOrderItem["itemTypeSnapshot"]) {
  return itemType === "COMMERCIAL_CONFIGURATION"
    ? "Caixa completa"
    : orderItemTypeLabels[itemType];
}

function compactItemTypeLabel(
  itemType: SupplierOrderItem["itemTypeSnapshot"],
) {
  const labels = {
    COMMERCIAL_CONFIGURATION: "Caixa",
    SERVO: "Servo",
    INSTALLATION_KIT: "Kit",
    REPAIR_KIT: "Reparo",
    LOOSE_PART: "Peça",
  } as const;

  return labels[itemType];
}

function StatusBadge({
  compact = false,
  status,
}: {
  compact?: boolean;
  status: SupplierOrderStatus;
}) {
  const details = statusDetails[status];

  return (
    <span
      className={`inline-flex rounded-full border font-black ${
        compact
          ? "px-1.5 py-0.5 text-[0.62rem]"
          : "px-2.5 py-1 text-xs"
      } ${details.className}`}
    >
      {details.label}
    </span>
  );
}

function MobileOrderSituation({ order }: { order: SupplierOrderSummary }) {
  const percentage = Math.max(0, Math.min(100, order.pickupPercentage));

  return (
    <div className="min-w-0">
      <StatusBadge status={order.status} compact />
      <p className="mt-1 text-[0.68rem] leading-tight font-black text-text-primary">
        {quantityFormatter.format(order.pickedQuantity)}/
        {quantityFormatter.format(order.orderedQuantity)}
        {order.status === "CANCELLED" ? " retirado" : ""}
      </p>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={order.orderedQuantity}
        aria-valuenow={order.pickedQuantity}
        aria-label={`Retirada do pedido ${order.negotiationNumber}`}
      >
        <span
          className="block h-full rounded-full bg-emerald-600"
          style={{ width: `${percentage}%` }}
        />
      </div>
      {order.cancelledQuantity > 0 ? (
        <p className="mt-1 text-[0.58rem] leading-tight font-bold text-red-800">
          {quantityFormatter.format(order.cancelledQuantity)} cancelado
        </p>
      ) : null}
    </div>
  );
}

function PickupProgress({
  order,
  showCancelled = true,
}: {
  order: SupplierOrderSummary;
  showCancelled?: boolean;
}) {
  const percentage = Math.max(0, Math.min(100, order.pickupPercentage));

  return (
    <div className="min-w-28 sm:min-w-36">
      <div className="flex items-center justify-between gap-3 text-xs font-bold text-text-muted">
        <span>
          <span className="sm:hidden">
            {quantityFormatter.format(order.pickedQuantity)}/
            {quantityFormatter.format(order.orderedQuantity)}
          </span>
          <span className="hidden sm:inline">
            {quantityFormatter.format(order.pickedQuantity)} de{" "}
            {quantityFormatter.format(order.orderedQuantity)} retirados
          </span>
        </span>
        <span>{quantityFormatter.format(Math.round(percentage))}%</span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={order.orderedQuantity}
        aria-valuenow={order.pickedQuantity}
        aria-label={`Retirada do pedido ${order.negotiationNumber}`}
      >
        <span
          className="block h-full rounded-full bg-emerald-600"
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showCancelled && order.cancelledQuantity > 0 ? (
        <p className="mt-1 text-[0.68rem] font-bold text-red-800">
          {quantityFormatter.format(order.cancelledQuantity)} cancelados
        </p>
      ) : null}
    </div>
  );
}

function useAccessibleDialog(
  dialogRef: RefObject<HTMLDivElement | null>,
  initialFocusRef: RefObject<HTMLElement | null>,
  isPending: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => initialFocusRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        if (
          document.querySelector('[data-commercial-image-dialog="true"]') ||
          document.querySelector(
            '[data-compatible-kit-images-dialog="true"]',
          )
        ) {
          return;
        }

        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (!firstElement || !lastElement) {
        return;
      }

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, [dialogRef, initialFocusRef, isPending, onClose]);
}

function DialogShell({
  children,
  compactMobileHeader = false,
  descriptionId,
  dialogRef,
  isPending,
  onClose,
  title,
  titleId,
  wide = false,
}: {
  children: React.ReactNode;
  compactMobileHeader?: boolean;
  descriptionId: string;
  dialogRef: RefObject<HTMLDivElement | null>;
  isPending: boolean;
  onClose: () => void;
  title: string;
  titleId: string;
  wide?: boolean;
}) {
  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onClose();
        }
      }}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] sm:p-4"
    >
      <div
        className={`flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-brand-gold/35 bg-surface shadow-2xl ${
          wide ? "max-w-6xl" : "max-w-xl"
        }`}
      >
        <div
          className={`flex shrink-0 items-start justify-between gap-4 border-b border-white/10 bg-brand-charcoal text-white ${
            compactMobileHeader
              ? "px-3 py-2 sm:px-4 sm:py-3"
              : "px-4 py-3 sm:px-5 sm:py-4"
          }`}
        >
          <div className="min-w-0">
            <h2
              id={titleId}
              className={`truncate font-black ${
                compactMobileHeader ? "text-lg sm:text-xl" : "text-xl"
              }`}
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Fechar"
            disabled={isPending}
            onClick={onClose}
            className={`nk-focus inline-flex shrink-0 items-center justify-center rounded-xl border border-white/20 transition hover:border-brand-gold hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 ${
              compactMobileHeader ? "size-10 sm:size-11" : "size-11"
            }`}
          >
            <CloseIcon className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function QuantityControl({
  disabled,
  label,
  maximum,
  minimum,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  maximum: number;
  minimum: number;
  onChange: (value: number) => void;
  value: number;
}) {
  function update(rawValue: number) {
    onChange(Math.max(minimum, Math.min(maximum, rawValue)));
  }

  return (
    <div className="inline-flex items-center rounded-xl border border-border-neutral bg-surface">
      <button
        type="button"
        aria-label={`Diminuir ${label}`}
        disabled={disabled || value <= minimum}
        onClick={() => update(value - 1)}
        className="nk-focus inline-flex size-11 items-center justify-center rounded-l-xl text-xl font-black text-text-primary transition hover:bg-app-background disabled:cursor-not-allowed disabled:opacity-35"
      >
        −
      </button>
      <input
        type="number"
        aria-label={label}
        inputMode="numeric"
        min={minimum}
        max={maximum}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isInteger(parsed)) {
            update(parsed);
          }
        }}
        className="nk-focus h-11 w-16 border-x border-border-neutral bg-white text-center font-mono font-black text-text-primary disabled:bg-slate-100"
      />
      <button
        type="button"
        aria-label={`Aumentar ${label}`}
        disabled={disabled || value >= maximum}
        onClick={() => update(value + 1)}
        className="nk-focus inline-flex size-11 items-center justify-center rounded-r-xl text-xl font-black text-text-primary transition hover:bg-app-background disabled:cursor-not-allowed disabled:opacity-35"
      >
        +
      </button>
    </div>
  );
}

function CompactQuantityControl({
  disabled,
  label,
  maximum,
  minimum,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  maximum: number;
  minimum: number;
  onChange: (value: number) => void;
  value: number;
}) {
  function update(rawValue: number) {
    onChange(Math.max(minimum, Math.min(maximum, rawValue)));
  }

  return (
    <div className="inline-flex items-center rounded-lg border border-border-neutral bg-surface">
      <button
        type="button"
        aria-label={`Diminuir ${label}`}
        disabled={disabled || value <= minimum}
        onClick={() => update(value - 1)}
        className="nk-focus inline-flex size-8 items-center justify-center rounded-l-lg text-base font-black text-text-primary disabled:cursor-not-allowed disabled:opacity-35"
      >
        −
      </button>
      <input
        type="number"
        aria-label={label}
        inputMode="numeric"
        min={minimum}
        max={maximum}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isInteger(parsed)) {
            update(parsed);
          }
        }}
        className="nk-focus h-8 w-8 border-x border-border-neutral bg-white text-center font-mono text-xs font-black text-text-primary disabled:bg-slate-100"
      />
      <button
        type="button"
        aria-label={`Aumentar ${label}`}
        disabled={disabled || value >= maximum}
        onClick={() => update(value + 1)}
        className="nk-focus inline-flex size-8 items-center justify-center rounded-r-lg text-base font-black text-text-primary disabled:cursor-not-allowed disabled:opacity-35"
      >
        +
      </button>
    </div>
  );
}

function OrderFormDialog({
  catalog,
  events,
  initialItems,
  mode,
  onClose,
  onSaved,
  onStale,
  order,
}: {
  catalog: SupplierOrdersData["catalog"];
  events: SupplierOrderEvent[];
  initialItems: SupplierOrderItem[];
  mode: "CREATE" | "EDIT";
  onClose: () => void;
  onSaved: (orderId: string, message: string) => void;
  onStale: (message: string) => void;
  order: SupplierOrderSummary | null;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const [negotiationNumber, setNegotiationNumber] = useState(
    order?.negotiationNumber ?? "",
  );
  const [orderDate, setOrderDate] = useState(
    order?.orderDate ?? getLocalDateInputValue(),
  );
  const [notes, setNotes] = useState(order?.notes ?? "");
  const movedLineIds = useMemo(
    () =>
      new Set(
        events.flatMap((event) =>
          event.supplierOrderItemId ? [event.supplierOrderItemId] : [],
        ),
      ),
    [events],
  );
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initialItems.map((item) => ({
      localId: item.id,
      existingId: item.id,
      kind:
        item.itemTypeSnapshot === "COMMERCIAL_CONFIGURATION"
          ? "COMMERCIAL_CONFIGURATION"
          : "ITEM",
      itemId: item.itemId,
      configurationId: item.commercialConfigurationId,
      commercialCodeId: item.commercialConfigurationCodeId,
      code: item.commercialCodeSnapshot ?? item.codeSnapshot,
      description: item.descriptionSnapshot,
      imageUrl: item.imageUrl,
      compatibleKitImages: item.compatibleKitImages,
      model: item.modelSnapshot,
      typeLabel: itemTypeLabel(item.itemTypeSnapshot),
      quantity: item.orderedQuantity,
      notes: item.notes ?? "",
      pickedQuantity: item.pickedQuantity,
      stockedQuantity: item.stockedQuantity,
      cancelledQuantity: item.cancelledQuantity,
      identityLocked:
        item.pickedQuantity > 0 ||
        item.stockedQuantity > 0 ||
        item.cancelledQuantity > 0 ||
        movedLineIds.has(item.id),
    })),
  );
  const [catalogSearch, setCatalogSearch] = useState("");
  const [openCatalogGroup, setOpenCatalogGroup] =
    useState<CatalogGroup | null>(null);
  const [openConfigurationFamilies, setOpenConfigurationFamilies] =
    useState<Set<string>>(new Set());
  const [selectedAliases, setSelectedAliases] = useState<
    Record<string, string>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useAccessibleDialog(dialogRef, firstInputRef, isPending, onClose);

  const normalizedCatalogSearch = normalizeSearch(catalogSearch.trim());
  const hasCatalogSearch = normalizedCatalogSearch.length > 0;
  const lineIdentities = useMemo(
    () => new Set(lines.map(lineIdentity)),
    [lines],
  );
  const filteredPhysicalItems = useMemo(
    () =>
      catalog.physicalItems.filter((item) =>
        [
          item.code,
          item.description,
          item.model,
          orderItemTypeLabels[item.itemType],
        ].some((value) =>
          value
            ? normalizeSearch(value).includes(normalizedCatalogSearch)
            : false,
        ),
      ),
    [catalog.physicalItems, normalizedCatalogSearch],
  );
  const filteredConfigurations = useMemo(
    () =>
      catalog.configurations.filter((configuration) =>
        [
          configuration.description,
          configuration.servoCode,
          configuration.servoDescription,
          configuration.servoModel,
          configuration.installationKitCode,
          configuration.installationKitDescription,
          ...configuration.aliases.map((alias) => alias.code),
        ].some((value) =>
          value
            ? normalizeSearch(value).includes(normalizedCatalogSearch)
            : false,
        ),
      ),
    [catalog.configurations, normalizedCatalogSearch],
  );
  const physicalCatalogGroups = useMemo(
    () =>
      [
        {
          id: "SERVO" as const,
          label: "Servoembreagens",
        },
        {
          id: "INSTALLATION_KIT" as const,
          label: "Kits instalação",
        },
        {
          id: "REPAIR_KIT" as const,
          label: "Jogos reparo",
        },
        {
          id: "LOOSE_PART" as const,
          label: "Peças avulsas",
        },
      ].map((group) => ({
        ...group,
        items: filteredPhysicalItems.filter(
          (item) => item.itemType === group.id,
        ),
      })),
    [filteredPhysicalItems],
  );
  const configurationFamilies = useMemo(() => {
    const configurationsByFamily = new Map<
      string,
      SupplierOrderCatalogConfiguration[]
    >();

    filteredConfigurations.forEach((configuration) => {
      const familyLabel = getServoFamilyLabel(
        configuration.servoModel,
        configuration.servoDescription,
      );
      const configurations =
        configurationsByFamily.get(familyLabel) ?? [];
      configurations.push(configuration);
      configurationsByFamily.set(familyLabel, configurations);
    });

    return Array.from(
      configurationsByFamily,
      ([label, configurations]) => ({
        label,
        configurations: configurations.sort((first, second) =>
          compareText(first.description, second.description),
        ),
      }),
    ).sort((first, second) => compareText(first.label, second.label));
  }, [filteredConfigurations]);

  function toggleCatalogGroup(group: CatalogGroup) {
    setOpenCatalogGroup((current) => (current === group ? null : group));
  }

  function toggleConfigurationFamily(family: string) {
    setOpenConfigurationFamilies((current) => {
      const next = new Set(current);
      if (next.has(family)) {
        next.delete(family);
      } else {
        next.add(family);
      }
      return next;
    });
  }

  function markChanged() {
    idempotencyKeyRef.current = null;
    setError(null);
  }

  function updateLine(localId: string, patch: Partial<DraftLine>) {
    markChanged();
    setLines((current) =>
      current.map((line) =>
        line.localId === localId ? { ...line, ...patch } : line,
      ),
    );
  }

  function removeLine(localId: string) {
    markChanged();
    setLines((current) =>
      current.filter(
        (line) => line.localId !== localId || line.identityLocked,
      ),
    );
  }

  function addPhysicalItem(item: SupplierOrderCatalogPhysicalItem) {
    const identity = `ITEM:${item.itemId}`;
    if (lineIdentities.has(identity)) {
      setError(`${item.code} já está no pedido.`);
      return;
    }

    markChanged();
    setLines((current) => [
      ...current,
      {
        localId: crypto.randomUUID(),
        existingId: null,
        kind: "ITEM",
        itemId: item.itemId,
        configurationId: null,
        commercialCodeId: null,
        code: item.code,
        description: item.description,
        imageUrl: item.imageUrl,
        compatibleKitImages: item.compatibleKitImages,
        model: item.model,
        typeLabel: orderItemTypeLabels[item.itemType],
        quantity: 1,
        notes: "",
        pickedQuantity: 0,
        stockedQuantity: 0,
        cancelledQuantity: 0,
        identityLocked: false,
      },
    ]);
  }

  function selectedAliasFor(
    configuration: SupplierOrderCatalogConfiguration,
  ) {
    const selectedId = selectedAliases[configuration.configurationId];
    return (
      configuration.aliases.find((alias) => alias.id === selectedId) ??
      configuration.aliases[0] ??
      null
    );
  }

  function addConfiguration(
    configuration: SupplierOrderCatalogConfiguration,
  ) {
    const selectedAlias = selectedAliasFor(configuration);
    const identity = `CONFIGURATION:${configuration.configurationId}:${
      selectedAlias?.id ?? "NONE"
    }`;

    if (lineIdentities.has(identity)) {
      setError(
        `${selectedAlias?.code ?? configuration.description} já está no pedido.`,
      );
      return;
    }

    markChanged();
    setLines((current) => [
      ...current,
      {
        localId: crypto.randomUUID(),
        existingId: null,
        kind: "COMMERCIAL_CONFIGURATION",
        itemId: null,
        configurationId: configuration.configurationId,
        commercialCodeId: selectedAlias?.id ?? null,
        code:
          selectedAlias?.code ??
          `${configuration.servoCode} + ${configuration.installationKitCode}`,
        description: configuration.description,
        imageUrl: configuration.imageUrl,
        compatibleKitImages: [],
        model: configuration.servoModel,
        typeLabel: "Caixa completa",
        quantity: 1,
        notes: "",
        pickedQuantity: 0,
        stockedQuantity: 0,
        cancelledQuantity: 0,
        identityLocked: false,
      },
    ]);
  }

  function buildPayloadLines(): SupplierOrderLineInput[] | null {
    const payloadLines: SupplierOrderLineInput[] = [];

    for (const line of lines) {
      const minimum = Math.max(
        1,
        line.pickedQuantity + line.cancelledQuantity,
      );

      if (
        !Number.isInteger(line.quantity) ||
        line.quantity < minimum ||
        line.quantity > maximumInteger ||
        line.notes.trim().length > 1_000
      ) {
        return null;
      }

      if (line.kind === "ITEM" && line.itemId) {
        payloadLines.push({
          ...(line.existingId ? { id: line.existingId } : {}),
          kind: "ITEM",
          item_id: line.itemId,
          quantity: line.quantity,
          notes: line.notes.trim() || null,
        });
      } else if (
        line.kind === "COMMERCIAL_CONFIGURATION" &&
        line.configurationId
      ) {
        payloadLines.push({
          ...(line.existingId ? { id: line.existingId } : {}),
          kind: "COMMERCIAL_CONFIGURATION",
          commercial_configuration_id: line.configurationId,
          commercial_configuration_code_id: line.commercialCodeId,
          quantity: line.quantity,
          notes: line.notes.trim() || null,
        });
      } else {
        return null;
      }
    }

    return payloadLines.length > 0 ? payloadLines : null;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const normalizedNumber = negotiationNumber.trim();
    const normalizedNotes = notes.trim();
    const payloadLines = buildPayloadLines();

    if (!normalizedNumber || normalizedNumber.length > 120) {
      setError("Informe o Nº do pedido com até 120 caracteres.");
      return;
    }

    if (!orderDate) {
      setError("Informe a data do pedido.");
      return;
    }

    if (normalizedNotes.length > 2_000) {
      setError("As observações devem ter no máximo 2.000 caracteres.");
      return;
    }

    if (!payloadLines) {
      setError(
        "Adicione ao menos um item e revise quantidades e observações.",
      );
      return;
    }

    const idempotencyKey =
      idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;
    const sharedInput: CreateSupplierOrderInput = {
      negotiation_number: normalizedNumber,
      order_date: orderDate,
      notes: normalizedNotes || null,
      lines: payloadLines,
      idempotency_key: idempotencyKey,
    };

    startTransition(async () => {
      const result =
        mode === "EDIT" && order
          ? await updateSupplierOrder({
              ...sharedInput,
              supplier_order_id: order.id,
              expected_updated_at: order.updatedAt,
            } satisfies UpdateSupplierOrderInput)
          : await createSupplierOrder(sharedInput);

      if (!result.ok) {
        if (result.stale) {
          onStale(result.error);
          return;
        }

        setError(result.error);
        return;
      }

      onSaved(
        result.receipt.supplierOrderId,
        mode === "EDIT"
          ? "Pedido atualizado com sucesso."
          : "Pedido criado com sucesso.",
      );
    });
  }

  return (
    <DialogShell
      title={mode === "EDIT" ? "Editar pedido" : "Novo pedido"}
      titleId={titleId}
      descriptionId={descriptionId}
      dialogRef={dialogRef}
      isPending={isPending}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={handleSubmit}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-3 pb-6 sm:p-5">
          <p
            id={descriptionId}
            className="text-sm leading-6 font-semibold text-text-muted"
          >
            Pedido e retirada acompanham a negociação com o fornecedor. Esta
            operação não movimenta estoque.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="md:col-span-1">
              <span className="mb-1.5 block text-xs font-black tracking-wide text-text-primary uppercase">
                Nº do pedido / Negociação
              </span>
              <input
                ref={firstInputRef}
                type="text"
                required
                maxLength={120}
                disabled={isPending}
                value={negotiationNumber}
                onChange={(event) => {
                  markChanged();
                  setNegotiationNumber(event.target.value);
                }}
                className="nk-focus h-12 w-full rounded-xl border border-border-neutral bg-white px-3 text-sm font-bold text-text-primary disabled:bg-slate-100"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-black tracking-wide text-text-primary uppercase">
                Data do pedido
              </span>
              <input
                type="date"
                required
                disabled={isPending}
                value={orderDate}
                onChange={(event) => {
                  markChanged();
                  setOrderDate(event.target.value);
                }}
                className="nk-focus h-12 w-full rounded-xl border border-border-neutral bg-white px-3 text-sm font-bold text-text-primary disabled:bg-slate-100"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-black tracking-wide text-text-primary uppercase">
                Observações
              </span>
              <input
                type="text"
                maxLength={2_000}
                disabled={isPending}
                value={notes}
                onChange={(event) => {
                  markChanged();
                  setNotes(event.target.value);
                }}
                placeholder="Opcional"
                className="nk-focus h-12 w-full rounded-xl border border-border-neutral bg-white px-3 text-sm font-semibold text-text-primary disabled:bg-slate-100"
              />
            </label>
          </div>

          <section
            className="order-2 mt-5"
            aria-labelledby={`${titleId}-lines`}
          >
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3
                  id={`${titleId}-lines`}
                  className="text-lg font-black text-text-primary"
                >
                  Itens do pedido
                </h3>
                <p className="text-xs font-semibold text-text-muted">
                  Quantidade solicitada por item ou caixa.
                </p>
              </div>
              <span className="rounded-full bg-app-background px-3 py-1 text-xs font-black text-text-muted">
                {quantityFormatter.format(lines.length)} tipos
              </span>
            </div>

            <div className="mt-3">
              {lines.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border-neutral bg-white px-3 py-4 text-center text-sm font-semibold text-text-muted sm:hidden">
                  Nenhum item adicionado.
                </p>
              ) : (
                <div className="divide-y divide-border-neutral overflow-hidden rounded-xl border border-border-neutral bg-white sm:hidden">
                  {lines.map((line) => {
                    const minimum = Math.max(
                      1,
                      line.pickedQuantity + line.cancelledQuantity,
                    );

                    return (
                      <article key={line.localId} className="p-2.5">
                        <div className="flex items-center gap-2">
                          <strong className="font-mono text-sm font-black text-text-primary">
                            {line.code}
                          </strong>
                          <OrderItemImageButton
                            code={line.code}
                            imageUrl={line.imageUrl}
                            compatibleKitImages={
                              line.compatibleKitImages
                            }
                          />
                          <span className="ml-auto rounded-full bg-app-background px-2 py-0.5 text-[0.6rem] font-black text-text-muted uppercase">
                            {line.typeLabel}
                          </span>
                        </div>
                        <p className="mt-1 break-words text-xs leading-4 font-semibold text-text-primary">
                          {line.description}
                          {line.model &&
                          !normalizeSearch(line.description).includes(
                            normalizeSearch(line.model),
                          )
                            ? ` · ${line.model}`
                            : ""}
                        </p>
                        <label className="mt-2 block">
                          <span className="sr-only">
                            Observação de {line.code}
                          </span>
                          <input
                            type="text"
                            maxLength={1_000}
                            disabled={isPending}
                            value={line.notes}
                            onChange={(event) =>
                              updateLine(line.localId, {
                                notes: event.target.value,
                              })
                            }
                            placeholder="Observação opcional"
                            className="nk-focus h-9 w-full rounded-lg border border-border-neutral px-2.5 text-xs font-semibold text-text-primary disabled:bg-slate-100"
                          />
                        </label>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="mr-2 text-[0.65rem] font-black text-text-muted uppercase">
                              Qtd.
                            </span>
                            <CompactQuantityControl
                              label={`Quantidade de ${line.code}`}
                              minimum={minimum}
                              maximum={maximumInteger}
                              value={line.quantity}
                              disabled={isPending}
                              onChange={(quantity) =>
                                updateLine(line.localId, { quantity })
                              }
                            />
                          </div>
                          {line.identityLocked ? (
                            <span className="text-xs font-bold text-sky-900">
                              Movimentada
                            </span>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Remover ${line.code}`}
                              disabled={isPending}
                              onClick={() => removeLine(line.localId)}
                              className="nk-focus inline-flex min-h-9 items-center gap-1 rounded-lg border border-red-200 px-2.5 text-xs font-black text-red-800 disabled:opacity-50"
                            >
                              <TrashIcon className="size-4" />
                              Remover
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              <div className="hidden max-w-full overflow-x-auto rounded-xl border border-border-neutral bg-white sm:block">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead className="bg-brand-charcoal text-white">
                  <tr>
                    {["Código", "Descrição", "Quantidade", "Tipo", "Ações"].map(
                      (heading) => (
                        <th
                          key={heading}
                          scope="col"
                          className="px-3 py-2.5 text-xs font-black tracking-wide uppercase"
                        >
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-center text-sm font-semibold text-text-muted"
                      >
                        Nenhum item adicionado.
                      </td>
                    </tr>
                  ) : (
                    lines.map((line) => {
                      const minimum = Math.max(
                        1,
                        line.pickedQuantity + line.cancelledQuantity,
                      );

                      return (
                        <tr
                          key={line.localId}
                          className="border-t border-border-neutral align-middle"
                        >
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-black text-text-primary">
                                {line.code}
                              </span>
                              <OrderItemImageButton
                                code={line.code}
                                imageUrl={line.imageUrl}
                                compatibleKitImages={
                                  line.compatibleKitImages
                                }
                              />
                            </div>
                          </td>
                          <td className="min-w-64 px-3 py-2.5">
                            <p className="text-sm font-semibold text-text-primary">
                              {line.description}
                              {line.model &&
                              !normalizeSearch(line.description).includes(
                                normalizeSearch(line.model),
                              )
                                ? ` · ${line.model}`
                                : ""}
                            </p>
                            <label className="mt-1.5 block">
                              <span className="sr-only">
                                Observação de {line.code}
                              </span>
                              <input
                                type="text"
                                maxLength={1_000}
                                disabled={isPending}
                                value={line.notes}
                                onChange={(event) =>
                                  updateLine(line.localId, {
                                    notes: event.target.value,
                                  })
                                }
                                placeholder="Observação opcional"
                                className="nk-focus h-9 w-full rounded-lg border border-border-neutral px-2.5 text-xs font-semibold text-text-primary disabled:bg-slate-100"
                              />
                            </label>
                          </td>
                          <td className="px-3 py-2.5">
                            <QuantityControl
                              label={`Quantidade de ${line.code}`}
                              minimum={minimum}
                              maximum={maximumInteger}
                              value={line.quantity}
                              disabled={isPending}
                              onChange={(quantity) =>
                                updateLine(line.localId, { quantity })
                              }
                            />
                            {minimum > 1 ? (
                              <p className="mt-1 text-[0.68rem] font-semibold text-text-muted">
                                Mínimo: {quantityFormatter.format(minimum)}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="rounded-full bg-app-background px-2 py-1 text-[0.65rem] font-black text-text-muted uppercase">
                              {line.typeLabel}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            {line.identityLocked ? (
                              <span className="text-xs font-bold text-sky-900">
                                Movimentada
                              </span>
                            ) : (
                              <button
                                type="button"
                                aria-label={`Remover ${line.code}`}
                                disabled={isPending}
                                onClick={() => removeLine(line.localId)}
                                className="nk-focus inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-red-200 px-3 text-xs font-black text-red-800 transition hover:bg-red-50 disabled:opacity-50"
                              >
                                <TrashIcon className="size-4" />
                                Remover
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              </div>
            </div>
          </section>

          <section
            className="order-1 mt-5 rounded-2xl border border-border-neutral bg-app-background p-3 sm:p-4"
            aria-labelledby={`${titleId}-catalog`}
          >
            <h3
              id={`${titleId}-catalog`}
              className="text-lg font-black text-text-primary"
            >
              Adicionar do catálogo
            </h3>
            <div className="relative mt-3">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-text-muted" />
              <input
                type="search"
                value={catalogSearch}
                disabled={isPending}
                onChange={(event) => setCatalogSearch(event.target.value)}
                placeholder="Código, descrição, modelo, alias ou kit..."
                className="nk-focus h-12 w-full rounded-xl border border-border-neutral bg-white pr-3 pl-10 text-sm font-semibold text-text-primary disabled:bg-slate-100"
              />
            </div>

            <div className="mt-3 space-y-2">
              <section className="overflow-hidden rounded-xl border border-violet-200 bg-white">
                <button
                  type="button"
                  aria-expanded={
                    openCatalogGroup === "CONFIGURATIONS" ||
                    (hasCatalogSearch &&
                      filteredConfigurations.length > 0)
                  }
                  aria-controls={`${titleId}-catalog-configurations`}
                  onClick={() => toggleCatalogGroup("CONFIGURATIONS")}
                  className="nk-focus flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left"
                >
                  <span>
                    <span className="block text-sm font-black text-text-primary">
                      Caixas completas
                    </span>
                    <span className="text-xs font-semibold text-text-muted">
                      {quantityFormatter.format(filteredConfigurations.length)}{" "}
                      configurações físicas
                    </span>
                  </span>
                  <ChevronDownIcon
                    className={`size-5 shrink-0 transition ${
                      openCatalogGroup === "CONFIGURATIONS" ||
                      (hasCatalogSearch &&
                        filteredConfigurations.length > 0)
                        ? "rotate-180"
                        : ""
                    }`}
                  />
                </button>
                {openCatalogGroup === "CONFIGURATIONS" ||
                (hasCatalogSearch &&
                  filteredConfigurations.length > 0) ? (
                  <div
                    id={`${titleId}-catalog-configurations`}
                    className="border-t border-violet-200 bg-violet-50/40 p-2"
                  >
                    {configurationFamilies.length === 0 ? (
                      <p className="rounded-lg bg-white p-3 text-sm font-semibold text-text-muted">
                        Nenhuma caixa completa encontrada.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {configurationFamilies.map((family, familyIndex) => {
                          const isFamilyOpen =
                            hasCatalogSearch ||
                            openConfigurationFamilies.has(family.label);
                          const familyId = `${titleId}-configuration-family-${familyIndex}`;

                          return (
                            <section
                              key={family.label}
                              className="overflow-hidden rounded-lg border border-violet-200 bg-white"
                            >
                              <button
                                type="button"
                                aria-expanded={isFamilyOpen}
                                aria-controls={familyId}
                                onClick={() =>
                                  toggleConfigurationFamily(family.label)
                                }
                                className="nk-focus flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left"
                              >
                                <span className="text-sm font-black text-text-primary">
                                  {family.label}
                                </span>
                                <span className="flex items-center gap-2 text-xs font-bold text-text-muted">
                                  {quantityFormatter.format(
                                    family.configurations.length,
                                  )}
                                  <ChevronDownIcon
                                    className={`size-4 transition ${
                                      isFamilyOpen ? "rotate-180" : ""
                                    }`}
                                  />
                                </span>
                              </button>
                              {isFamilyOpen ? (
                                <div
                                  id={familyId}
                                  className="max-w-full overflow-x-auto border-t border-violet-100"
                                >
                                  <div className="divide-y divide-violet-100 sm:hidden">
                                    {family.configurations.map(
                                      (configuration) => {
                                        const selectedAlias =
                                          selectedAliasFor(configuration);
                                        const identity = `CONFIGURATION:${
                                          configuration.configurationId
                                        }:${selectedAlias?.id ?? "NONE"}`;
                                        const added =
                                          lineIdentities.has(identity);
                                        const displayedCode =
                                          selectedAlias?.code ??
                                          configuration.aliases[0]?.code ??
                                          configuration.description;

                                        return (
                                          <article
                                            key={
                                              configuration.configurationId
                                            }
                                            className="p-2.5"
                                          >
                                            <p className="text-sm font-black text-text-primary">
                                              {configuration.description}
                                            </p>
                                            <p className="mt-0.5 text-xs font-semibold text-text-muted">
                                              Servo{" "}
                                              {configuration.servoCode} ·{" "}
                                              {
                                                configuration.installationKitCode
                                              }
                                            </p>
                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                              {configuration.aliases.length >
                                              0 ? (
                                                <select
                                                  aria-label={`Código comercial de ${configuration.description}`}
                                                  value={
                                                    selectedAlias?.id ??
                                                    configuration.aliases[0]
                                                      ?.id
                                                  }
                                                  disabled={isPending}
                                                  onChange={(event) => {
                                                    setSelectedAliases(
                                                      (current) => ({
                                                        ...current,
                                                        [configuration.configurationId]:
                                                          event.target.value,
                                                      }),
                                                    );
                                                    setError(null);
                                                  }}
                                                  className="nk-focus h-10 min-w-24 flex-1 rounded-lg border border-violet-200 bg-white px-2 font-mono text-sm font-black text-text-primary"
                                                >
                                                  {configuration.aliases.map(
                                                    (alias) => (
                                                      <option
                                                        key={alias.id}
                                                        value={alias.id}
                                                      >
                                                        {alias.code}
                                                      </option>
                                                    ),
                                                  )}
                                                </select>
                                              ) : (
                                                <span className="text-xs font-semibold text-text-muted">
                                                  Sem código ativo
                                                </span>
                                              )}
                                              {configuration.imageUrl ? (
                                                <CommercialConfigurationImage
                                                  commercialCodes={[
                                                    displayedCode,
                                                  ]}
                                                  imageUrl={
                                                    configuration.imageUrl
                                                  }
                                                  triggerVariant="icon-button"
                                                />
                                              ) : null}
                                              <button
                                                type="button"
                                                disabled={
                                                  isPending || added
                                                }
                                                onClick={() =>
                                                  addConfiguration(
                                                    configuration,
                                                  )
                                                }
                                                aria-label={`Adicionar ${displayedCode}`}
                                                className="nk-focus inline-flex min-h-10 items-center gap-1 rounded-lg bg-violet-800 px-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
                                              >
                                                {added ? (
                                                  <CheckIcon className="size-4" />
                                                ) : (
                                                  <PlusIcon className="size-4" />
                                                )}
                                                {added
                                                  ? "Adicionada"
                                                  : "Adicionar"}
                                              </button>
                                            </div>
                                          </article>
                                        );
                                      },
                                    )}
                                  </div>

                                  <table className="hidden w-full min-w-[640px] border-collapse text-left sm:table">
                                    <thead className="bg-violet-100/70">
                                      <tr>
                                        <th
                                          scope="col"
                                          className="px-3 py-2 text-[0.68rem] font-black uppercase"
                                        >
                                          Configuração física
                                        </th>
                                        <th
                                          scope="col"
                                          className="px-3 py-2 text-[0.68rem] font-black uppercase"
                                        >
                                          Código comercial
                                        </th>
                                        <th
                                          scope="col"
                                          className="px-3 py-2 text-[0.68rem] font-black uppercase"
                                        >
                                          Ação
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {family.configurations.map(
                                        (configuration) => {
                                          const selectedAlias =
                                            selectedAliasFor(configuration);
                                          const identity = `CONFIGURATION:${
                                            configuration.configurationId
                                          }:${selectedAlias?.id ?? "NONE"}`;
                                          const added =
                                            lineIdentities.has(identity);

                                          return (
                                            <tr
                                              key={
                                                configuration.configurationId
                                              }
                                              className="border-t border-violet-100"
                                            >
                                              <td className="px-3 py-2.5">
                                                <p className="text-sm font-black text-text-primary">
                                                  {
                                                    configuration.description
                                                  }
                                                </p>
                                                <p className="text-xs font-semibold text-text-muted">
                                                  Servo{" "}
                                                  {configuration.servoCode} +{" "}
                                                  {
                                                    configuration.installationKitCode
                                                  }
                                                </p>
                                              </td>
                                              <td className="px-3 py-2.5">
                                                <div className="flex items-center gap-2">
                                                  {configuration.aliases
                                                    .length > 0 ? (
                                                    <select
                                                      aria-label={`Código comercial de ${configuration.description}`}
                                                      value={
                                                        selectedAlias?.id ??
                                                        configuration
                                                          .aliases[0]?.id
                                                      }
                                                      disabled={isPending}
                                                      onChange={(event) => {
                                                        setSelectedAliases(
                                                          (current) => ({
                                                            ...current,
                                                            [configuration.configurationId]:
                                                              event.target
                                                                .value,
                                                          }),
                                                        );
                                                        setError(null);
                                                      }}
                                                      className="nk-focus h-10 min-w-28 rounded-lg border border-violet-200 bg-white px-2 font-mono text-sm font-black text-text-primary"
                                                    >
                                                      {configuration.aliases.map(
                                                        (alias) => (
                                                          <option
                                                            key={alias.id}
                                                            value={alias.id}
                                                          >
                                                            {alias.code}
                                                          </option>
                                                        ),
                                                      )}
                                                    </select>
                                                  ) : (
                                                    <span className="text-xs font-semibold text-text-muted">
                                                      Sem código ativo
                                                    </span>
                                                  )}
                                                  {configuration.imageUrl ? (
                                                    <CommercialConfigurationImage
                                                      commercialCodes={[
                                                        selectedAlias?.code ??
                                                          configuration
                                                            .aliases[0]
                                                            ?.code ??
                                                          configuration.description,
                                                      ]}
                                                      imageUrl={
                                                        configuration.imageUrl
                                                      }
                                                      triggerVariant="icon-button"
                                                    />
                                                  ) : null}
                                                </div>
                                              </td>
                                              <td className="px-3 py-2.5">
                                                <button
                                                  type="button"
                                                  disabled={
                                                    isPending || added
                                                  }
                                                  onClick={() =>
                                                    addConfiguration(
                                                      configuration,
                                                    )
                                                  }
                                                  className="nk-focus inline-flex min-h-11 items-center gap-1 rounded-xl bg-violet-800 px-3 text-xs font-black text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
                                                >
                                                  {added ? (
                                                    <CheckIcon className="size-4" />
                                                  ) : (
                                                    <PlusIcon className="size-4" />
                                                  )}
                                                  {added
                                                    ? "Adicionada"
                                                    : "Adicionar"}
                                                </button>
                                              </td>
                                            </tr>
                                          );
                                        },
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              ) : null}
                            </section>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </section>

              {physicalCatalogGroups.map((group, groupIndex) => {
                const isOpen =
                  openCatalogGroup === group.id ||
                  (hasCatalogSearch && group.items.length > 0);
                const groupId = `${titleId}-catalog-physical-${groupIndex}`;

                return (
                  <section
                    key={group.id}
                    className="overflow-hidden rounded-xl border border-border-neutral bg-white"
                  >
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={groupId}
                      onClick={() => toggleCatalogGroup(group.id)}
                      className="nk-focus flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left"
                    >
                      <span>
                        <span className="block text-sm font-black text-text-primary">
                          {group.label}
                        </span>
                        <span className="text-xs font-semibold text-text-muted">
                          {quantityFormatter.format(group.items.length)} itens
                        </span>
                      </span>
                      <ChevronDownIcon
                        className={`size-5 shrink-0 transition ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                    {isOpen ? (
                      <div
                        id={groupId}
                        className="max-w-full overflow-x-auto border-t border-border-neutral"
                      >
                        <div className="divide-y divide-border-neutral sm:hidden">
                          {group.items.length === 0 ? (
                            <p className="p-3 text-sm font-semibold text-text-muted">
                              Nenhum item encontrado.
                            </p>
                          ) : (
                            group.items.map((item) => {
                              const added = lineIdentities.has(
                                `ITEM:${item.itemId}`,
                              );

                              return (
                                <article key={item.itemId} className="p-2.5">
                                  <div className="flex items-center gap-2">
                                    <strong className="font-mono text-sm font-black text-text-primary">
                                      {item.code}
                                    </strong>
                                    <OrderItemImageButton
                                      code={item.code}
                                      imageUrl={item.imageUrl}
                                      compatibleKitImages={
                                        item.compatibleKitImages
                                      }
                                    />
                                  </div>
                                  <p className="mt-1 break-words text-xs leading-4 font-semibold text-text-primary">
                                    {item.description}
                                  </p>
                                  {item.model &&
                                  !normalizeSearch(item.description).includes(
                                    normalizeSearch(item.model),
                                  ) ? (
                                    <p className="text-xs font-semibold text-text-muted">
                                      {item.model}
                                    </p>
                                  ) : null}
                                  <button
                                    type="button"
                                    disabled={isPending || added}
                                    onClick={() => addPhysicalItem(item)}
                                    aria-label={`Adicionar ${item.code}`}
                                    className="nk-focus mt-2 inline-flex min-h-10 items-center gap-1 rounded-lg bg-brand-charcoal px-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
                                  >
                                    {added ? (
                                      <CheckIcon className="size-4" />
                                    ) : (
                                      <PlusIcon className="size-4" />
                                    )}
                                    {added ? "Adicionado" : "Adicionar"}
                                  </button>
                                </article>
                              );
                            })
                          )}
                        </div>

                        <table className="hidden w-full min-w-[560px] border-collapse text-left sm:table">
                          <thead className="bg-app-background">
                            <tr>
                              <th
                                scope="col"
                                className="px-3 py-2 text-[0.68rem] font-black uppercase"
                              >
                                Código
                              </th>
                              <th
                                scope="col"
                                className="px-3 py-2 text-[0.68rem] font-black uppercase"
                              >
                                Descrição
                              </th>
                              <th
                                scope="col"
                                className="px-3 py-2 text-[0.68rem] font-black uppercase"
                              >
                                Ação
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.items.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={3}
                                  className="px-3 py-5 text-center text-sm font-semibold text-text-muted"
                                >
                                  Nenhum item encontrado.
                                </td>
                              </tr>
                            ) : (
                              group.items.map((item) => {
                                const added = lineIdentities.has(
                                  `ITEM:${item.itemId}`,
                                );

                                return (
                                  <tr
                                    key={item.itemId}
                                    className="border-t border-border-neutral"
                                  >
                                    <td className="px-3 py-2.5">
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono text-sm font-black text-text-primary">
                                          {item.code}
                                        </span>
                                        <OrderItemImageButton
                                          code={item.code}
                                          imageUrl={item.imageUrl}
                                          compatibleKitImages={
                                            item.compatibleKitImages
                                          }
                                        />
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <p className="text-sm font-semibold text-text-primary">
                                        {item.description}
                                      </p>
                                      {item.model &&
                                      !normalizeSearch(
                                        item.description,
                                      ).includes(
                                        normalizeSearch(item.model),
                                      ) ? (
                                        <p className="text-xs font-semibold text-text-muted">
                                          {item.model}
                                        </p>
                                      ) : null}
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <button
                                        type="button"
                                        disabled={isPending || added}
                                        onClick={() =>
                                          addPhysicalItem(item)
                                        }
                                        aria-label={`Adicionar ${item.code}`}
                                        className="nk-focus inline-flex min-h-11 items-center gap-1 rounded-xl bg-brand-charcoal px-3 text-xs font-black text-white transition hover:bg-brand-charcoal-soft disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
                                      >
                                        {added ? (
                                          <CheckIcon className="size-4" />
                                        ) : (
                                          <PlusIcon className="size-4" />
                                        )}
                                        {added
                                          ? "Adicionado"
                                          : "Adicionar"}
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </section>

          {error ? (
            <p
              role="alert"
              className="order-3 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border-neutral bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:p-4">
          <button
            type="button"
            disabled={isPending}
            onClick={onClose}
            className="nk-focus min-h-12 rounded-xl border border-border-neutral px-5 text-sm font-black text-text-primary transition hover:bg-app-background disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="nk-focus min-h-12 rounded-xl bg-brand-charcoal px-5 text-sm font-black text-white transition hover:bg-brand-charcoal-soft disabled:cursor-wait disabled:opacity-60"
          >
            {isPending
              ? "Salvando..."
              : mode === "EDIT"
                ? "Salvar alterações"
                : "Criar pedido"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

function ConfirmationDialog({
  kind,
  onClose,
  onSuccess,
  order,
}: {
  kind: ConfirmationKind;
  onClose: () => void;
  onSuccess: (message: string) => void;
  order: SupplierOrderSummary;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonInputRef = useRef<HTMLTextAreaElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isCancellation = kind !== "MARK_ALL";
  const title =
    kind === "MARK_ALL"
      ? "Marcar tudo como retirado"
      : kind === "CANCEL"
        ? "Cancelar pedido"
        : "Cancelar saldo restante";

  useAccessibleDialog(
    dialogRef,
    isCancellation ? reasonInputRef : confirmButtonRef,
    isPending,
    onClose,
  );

  function handleConfirm() {
    setError(null);
    const normalizedReason = reason.trim();

    if (
      isCancellation &&
      (normalizedReason.length < 3 || normalizedReason.length > 500)
    ) {
      setError("Informe um motivo entre 3 e 500 caracteres.");
      return;
    }

    const idempotencyKey =
      idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;

    startTransition(async () => {
      const result =
        kind === "MARK_ALL"
          ? await markSupplierOrderAllPicked({
              supplier_order_id: order.id,
              description: null,
              idempotency_key: idempotencyKey,
            })
          : kind === "CANCEL"
            ? await cancelSupplierOrder({
                supplier_order_id: order.id,
                cancellation_note: normalizedReason,
                idempotency_key: idempotencyKey,
              })
            : await cancelSupplierOrderRemaining({
                supplier_order_id: order.id,
                cancellation_note: normalizedReason,
                idempotency_key: idempotencyKey,
              });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onSuccess(
        kind === "MARK_ALL"
          ? "Todas as quantidades restantes foram marcadas como retiradas."
          : kind === "CANCEL"
            ? "Pedido cancelado."
            : "Saldo restante cancelado.",
      );
    });
  }

  return (
    <DialogShell
      title={title}
      titleId={titleId}
      descriptionId={descriptionId}
      dialogRef={dialogRef}
      isPending={isPending}
      onClose={onClose}
    >
      <div className="overflow-y-auto p-5">
        <p
          id={descriptionId}
          className="text-sm leading-6 font-semibold text-text-muted"
        >
          {kind === "MARK_ALL"
            ? "Marcar todas as quantidades restantes como retiradas no fornecedor?"
            : kind === "CANCEL"
              ? "O pedido será preservado e todas as quantidades ainda intocadas serão canceladas."
              : "As quantidades já retiradas serão preservadas; somente o que falta retirar será cancelado."}
        </p>
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-950">
          Isso não altera o estoque.
        </p>

        {isCancellation ? (
          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-black tracking-wide text-text-primary uppercase">
              Motivo do cancelamento
            </span>
            <textarea
              ref={reasonInputRef}
              rows={4}
              required
              minLength={3}
              maxLength={500}
              disabled={isPending}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                idempotencyKeyRef.current = null;
                setError(null);
              }}
              className="nk-focus w-full resize-y rounded-xl border border-border-neutral p-3 text-sm font-semibold text-text-primary disabled:bg-slate-100"
            />
          </label>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900"
          >
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-border-neutral p-4 sm:flex-row sm:justify-end">
        <button
          ref={confirmButtonRef}
          type="button"
          disabled={isPending}
          onClick={onClose}
          className="nk-focus min-h-12 rounded-xl border border-border-neutral px-5 text-sm font-black text-text-primary transition hover:bg-app-background disabled:opacity-50"
        >
          Voltar
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={handleConfirm}
          className={`nk-focus min-h-12 rounded-xl px-5 text-sm font-black text-white transition disabled:cursor-wait disabled:opacity-60 ${
            kind === "MARK_ALL"
              ? "bg-emerald-700 hover:bg-emerald-800"
              : "bg-red-700 hover:bg-red-800"
          }`}
        >
          {isPending ? "Confirmando..." : title}
        </button>
      </div>
    </DialogShell>
  );
}

function OrderDetailsDialog({
  items,
  onClose,
  onEdit,
  onMutated,
  order,
}: {
  items: SupplierOrderItem[];
  onClose: () => void;
  onEdit: () => void;
  onMutated: (message: string) => void;
  order: SupplierOrderSummary;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pickedKeysRef = useRef<Record<string, string>>({});
  const [pickedDrafts, setPickedDrafts] = useState<Record<string, number>>(
    () => Object.fromEntries(items.map((item) => [item.id, item.pickedQuantity])),
  );
  const [confirmation, setConfirmation] =
    useState<ConfirmationKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClose = useCallback(() => {
    if (!isPending) {
      onClose();
    }
  }, [isPending, onClose]);

  useAccessibleDialog(
    dialogRef,
    closeButtonRef,
    isPending || Boolean(confirmation),
    handleClose,
  );

  if (confirmation) {
    return (
      <ConfirmationDialog
        kind={confirmation}
        order={order}
        onClose={() => setConfirmation(null)}
        onSuccess={(message) => {
          setConfirmation(null);
          onMutated(message);
        }}
      />
    );
  }

  const canEdit =
    order.status === "PENDING" || order.status === "PARTIAL";
  const canChangePickup = canEdit;
  const canMarkAll =
    order.status !== "CANCELLED" &&
    order.status !== "COMPLETED" &&
    order.waitingPickupQuantity > 0;
  const canCancelFull =
    canEdit &&
    order.pickedQuantity === 0 &&
    order.stockedQuantity === 0 &&
    order.waitingPickupQuantity > 0;
  const canCancelRemaining =
    canEdit &&
    (order.pickedQuantity > 0 || order.stockedQuantity > 0) &&
    order.waitingPickupQuantity > 0;
  const hasFooterActions =
    canEdit || canMarkAll || canCancelFull || canCancelRemaining;
  const waitingStockMessage =
    order.waitingStockQuantity === 1
      ? "1 unidade aguarda entrada no estoque"
      : `${quantityFormatter.format(
          order.waitingStockQuantity,
        )} unidades aguardam entrada no estoque`;

  function updatePicked(item: SupplierOrderItem, nextValue: number) {
    const minimum = item.stockedQuantity;
    const maximum = item.orderedQuantity - item.cancelledQuantity;
    const bounded = Math.max(minimum, Math.min(maximum, nextValue));

    delete pickedKeysRef.current[item.id];
    setError(null);
    setPickedDrafts((current) => ({ ...current, [item.id]: bounded }));
  }

  function savePicked(item: SupplierOrderItem) {
    const value = pickedDrafts[item.id] ?? item.pickedQuantity;
    const minimum = item.stockedQuantity;
    const maximum = item.orderedQuantity - item.cancelledQuantity;

    if (
      !Number.isInteger(value) ||
      value < minimum ||
      value > maximum
    ) {
      setError(
        "A quantidade retirada deve ficar entre o que já entrou no estoque e o total disponível.",
      );
      return;
    }

    const idempotencyKey =
      pickedKeysRef.current[item.id] ?? crypto.randomUUID();
    pickedKeysRef.current[item.id] = idempotencyKey;
    setPendingItemId(item.id);
    setError(null);

    startTransition(async () => {
      const result = await setSupplierOrderItemPickedQuantity({
        supplier_order_item_id: item.id,
        picked_quantity: value,
        description: null,
        idempotency_key: idempotencyKey,
      });

      setPendingItemId(null);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      delete pickedKeysRef.current[item.id];
      onMutated(`Retirada de ${item.codeSnapshot} atualizada.`);
    });
  }

  return (
    <DialogShell
      title={`Pedido ${order.negotiationNumber}`}
      titleId={titleId}
      descriptionId={descriptionId}
      dialogRef={dialogRef}
      isPending={isPending}
      onClose={handleClose}
      wide
      compactMobileHeader
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="border-b border-border-neutral px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p
              id={descriptionId}
              className="text-sm font-black text-brand-gold-ink"
            >
              {formatOrderDate(order.orderDate)}
            </p>
            <StatusBadge status={order.status} />
          </div>
          {order.notes ? (
            <p className="mt-2 rounded-lg bg-app-background px-3 py-1.5 text-xs leading-5 font-semibold text-text-primary sm:text-sm">
              {order.notes}
            </p>
          ) : null}
        </div>

        <section
          className="border-b border-border-neutral px-3 py-2.5 sm:px-4 sm:py-3"
          aria-labelledby={`${titleId}-progress`}
        >
          <h3
            id={`${titleId}-progress`}
            className="sr-only"
          >
            Progresso geral
          </h3>
          <p className="text-xs font-bold text-text-primary sm:text-sm">
            {quantityFormatter.format(order.orderedQuantity)} solicitadas ·{" "}
            {quantityFormatter.format(order.pickedQuantity)} retiradas ·{" "}
            {quantityFormatter.format(order.waitingPickupQuantity)} faltantes
          </p>
          <div className="mt-1.5 flex items-center justify-between gap-3 font-mono text-xs font-black text-text-primary">
            <span>
              {quantityFormatter.format(order.pickedQuantity)}/
              {quantityFormatter.format(order.orderedQuantity)}
            </span>
            <span>{Math.round(order.pickupPercentage)}%</span>
          </div>
          <div
            className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={order.orderedQuantity}
            aria-valuenow={order.pickedQuantity}
            aria-label={`Progresso do pedido ${order.negotiationNumber}`}
          >
            <span
              className="block h-full rounded-full bg-emerald-600"
              style={{
                width: `${Math.max(
                  0,
                  Math.min(100, order.pickupPercentage),
                )}%`,
              }}
            />
          </div>
          {order.cancelledQuantity > 0 ? (
            <p className="mt-1.5 text-xs font-bold text-red-800">
              {quantityFormatter.format(order.cancelledQuantity)} unidades
              canceladas.
            </p>
          ) : null}
        </section>

        <section
          className="px-3 py-2.5 sm:px-4 sm:py-3"
          aria-labelledby={`${titleId}-items`}
        >
          <h3
            id={`${titleId}-items`}
            className="text-base font-black text-text-primary sm:text-lg"
          >
            Itens do pedido
          </h3>
          <div className="mt-1.5 divide-y divide-border-neutral overflow-hidden rounded-xl border border-border-neutral bg-white">
            {items.map((item) => {
              const minimum = item.stockedQuantity;
              const maximum =
                item.orderedQuantity - item.cancelledQuantity;
              const pickedValue =
                pickedDrafts[item.id] ?? item.pickedQuantity;
              const changed = pickedValue !== item.pickedQuantity;
              const code =
                item.commercialCodeSnapshot ?? item.codeSnapshot;
              const hasImage =
                Boolean(item.imageUrl) ||
                item.compatibleKitImages.length > 0;

              return (
                <article key={item.id} className="px-2.5 py-2 sm:px-3">
                  <div
                    className={`grid min-w-0 items-center gap-x-1.5 ${
                      hasImage
                        ? "grid-cols-[auto_auto_auto_minmax(0,1fr)]"
                        : "grid-cols-[auto_auto_minmax(0,1fr)]"
                    }`}
                  >
                    <span className="rounded-full bg-app-background px-1.5 py-0.5 text-[0.58rem] font-black text-text-muted uppercase sm:text-[0.62rem]">
                      {compactItemTypeLabel(item.itemTypeSnapshot)}
                    </span>
                    <strong className="font-mono text-xs font-black text-text-primary sm:text-sm">
                      {code}
                    </strong>
                    {hasImage ? (
                      <OrderItemImageButton
                        code={code}
                        imageUrl={item.imageUrl}
                        compatibleKitImages={item.compatibleKitImages}
                      />
                    ) : null}
                    <p className="line-clamp-2 min-w-0 break-words text-xs leading-4 font-semibold text-text-primary sm:text-sm sm:leading-5">
                      {item.descriptionSnapshot}
                      {item.modelSnapshot &&
                      !normalizeSearch(item.descriptionSnapshot).includes(
                        normalizeSearch(item.modelSnapshot),
                      )
                        ? ` · ${item.modelSnapshot}`
                        : ""}
                      {item.notes ? (
                        <span className="font-medium text-text-muted">
                          {" "}
                          · Obs.: {item.notes}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <div
                    className={`mt-1.5 grid items-end gap-2 ${
                      canChangePickup
                        ? "grid-cols-1 min-[360px]:grid-cols-[minmax(0,1fr)_auto]"
                        : "grid-cols-[minmax(0,1fr)_auto]"
                    }`}
                  >
                    <div className="min-w-0">
                      <ItemQuantityIndicators
                        orderedQuantity={item.orderedQuantity}
                        pickedQuantity={item.pickedQuantity}
                        waitingPickupQuantity={
                          item.waitingPickupQuantity
                        }
                      />
                      {item.cancelledQuantity > 0 ? (
                        <p className="mt-0.5 text-[0.62rem] leading-4 font-bold text-red-800 sm:text-xs">
                          Cancelado:{" "}
                          {quantityFormatter.format(
                            item.cancelledQuantity,
                          )}
                        </p>
                      ) : null}
                      {item.waitingStockQuantity > 0 ? (
                        <p className="mt-0.5 text-[0.62rem] leading-4 font-bold text-amber-900 sm:text-xs">
                          Aguardando entrada:{" "}
                          {quantityFormatter.format(
                            item.waitingStockQuantity,
                          )}
                        </p>
                      ) : null}
                    </div>

                    {canChangePickup ? (
                      <div className="flex flex-wrap items-end justify-start gap-1.5 min-[360px]:justify-end">
                        <div>
                          <span className="mb-0.5 block text-[0.58rem] font-black text-text-muted uppercase">
                            Retirado
                          </span>
                          <CompactQuantityControl
                            label={`Quantidade retirada de ${code}`}
                            minimum={minimum}
                            maximum={maximum}
                            value={pickedValue}
                            disabled={isPending}
                            onChange={(value) =>
                              updatePicked(item, value)
                            }
                          />
                        </div>
                        <button
                          type="button"
                          disabled={!changed || isPending}
                          onClick={() => savePicked(item)}
                          className="nk-focus min-h-8 rounded-lg bg-sky-700 px-2.5 text-[0.65rem] font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
                        >
                          {isPending && pendingItemId === item.id
                            ? "Salvando..."
                            : "Salvar"}
                        </button>
                      </div>
                    ) : (
                      <p className="shrink-0 text-right text-xs font-black text-text-primary">
                        Retirado:{" "}
                        {quantityFormatter.format(item.pickedQuantity)}/
                        {quantityFormatter.format(item.orderedQuantity)}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {order.waitingStockQuantity > 0 ? (
          <section className="border-t border-border-neutral px-3 py-2 sm:px-4">
            <p className="rounded-lg border border-brand-gold/35 bg-brand-gold-soft/40 px-3 py-1.5 text-xs font-bold text-text-primary">
              {waitingStockMessage}{" "}
              <span className="text-brand-gold-ink">· Em breve</span>
            </p>
          </section>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mx-4 mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900 sm:mx-5"
          >
            {error}
          </p>
        ) : null}
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-border-neutral bg-white p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:flex sm:flex-wrap sm:justify-end sm:p-3">
        {canEdit ? (
          <button
            type="button"
            disabled={isPending}
            onClick={onEdit}
            className="nk-focus min-h-10 rounded-xl border border-border-neutral px-3 text-center text-xs leading-tight font-black text-text-primary transition hover:bg-app-background disabled:opacity-50 sm:min-h-11 sm:px-4 sm:text-sm"
          >
            Editar pedido
          </button>
        ) : null}
        {canMarkAll ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirmation("MARK_ALL")}
            className="nk-focus min-h-10 rounded-xl bg-emerald-700 px-3 text-center text-xs leading-tight font-black text-white transition hover:bg-emerald-800 disabled:opacity-50 sm:min-h-11 sm:px-4 sm:text-sm"
          >
            Marcar tudo como retirado
          </button>
        ) : null}
        {canCancelFull ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirmation("CANCEL")}
            className="nk-focus min-h-10 rounded-xl border border-red-300 px-3 text-center text-xs leading-tight font-black text-red-800 transition hover:bg-red-50 disabled:opacity-50 sm:min-h-11 sm:px-4 sm:text-sm"
          >
            Cancelar pedido
          </button>
        ) : null}
        {canCancelRemaining ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirmation("CANCEL_REMAINING")}
            className="nk-focus min-h-10 rounded-xl border border-red-300 px-3 text-center text-xs leading-tight font-black text-red-800 transition hover:bg-red-50 disabled:opacity-50 sm:min-h-11 sm:px-4 sm:text-sm"
          >
            Cancelar saldo restante
          </button>
        ) : null}
        <button
          ref={closeButtonRef}
          type="button"
          disabled={isPending}
          onClick={handleClose}
          className={`nk-focus min-h-10 rounded-xl bg-brand-charcoal px-3 text-center text-xs font-black text-white transition hover:bg-brand-charcoal-soft disabled:opacity-50 sm:ml-0 sm:min-h-11 sm:px-4 sm:text-sm ${
            hasFooterActions
              ? ""
              : "col-span-2 sm:ml-auto"
          }`}
        >
          Fechar
        </button>
      </div>
    </DialogShell>
  );
}

function orderMatchesPeriod(orderDate: string, period: PeriodFilter) {
  if (period === "ALL") {
    return true;
  }

  const [year, month, day] = orderDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  if (period === "MONTH") {
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth()
    );
  }

  const days = Number(period);
  const start = new Date(today);
  start.setDate(start.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);
  return date >= start && date <= today;
}

export function SupplierOrdersWorkspace({
  data,
}: SupplierOrdersWorkspaceProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("ALL");
  const [sort, setSort] = useState<OrderSort>("RECENT");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const itemsByOrder = useMemo(() => {
    const grouped = new Map<string, SupplierOrderItem[]>();
    data.items.forEach((item) => {
      const current = grouped.get(item.supplierOrderId) ?? [];
      current.push(item);
      grouped.set(item.supplierOrderId, current);
    });
    grouped.forEach((items) =>
      items.sort(
        (first, second) =>
          first.position - second.position ||
          compareText(first.codeSnapshot, second.codeSnapshot),
      ),
    );
    return grouped;
  }, [data.items]);

  const eventsByOrder = useMemo(() => {
    const grouped = new Map<string, SupplierOrderEvent[]>();
    data.events.forEach((event) => {
      const current = grouped.get(event.supplierOrderId) ?? [];
      current.push(event);
      grouped.set(event.supplierOrderId, current);
    });
    return grouped;
  }, [data.events]);

  const orderById = useMemo(
    () => new Map(data.summaries.map((order) => [order.id, order])),
    [data.summaries],
  );
  const selectedOrder = selectedOrderId
    ? (orderById.get(selectedOrderId) ?? null)
    : null;
  const editingOrder = editingOrderId
    ? (orderById.get(editingOrderId) ?? null)
    : null;
  const normalizedQuery = normalizeSearch(search.trim());

  const indicators = useMemo(
    () => ({
      pending: data.summaries.filter((order) => order.status === "PENDING")
        .length,
      partial: data.summaries.filter((order) => order.status === "PARTIAL")
        .length,
      completed: data.summaries.filter(
        (order) => order.status === "COMPLETED",
      ).length,
      waiting: data.summaries.reduce(
        (total, order) => total + order.waitingPickupQuantity,
        0,
      ),
    }),
    [data.summaries],
  );

  const filteredOrders = useMemo(() => {
    const result = data.summaries.filter((order) => {
      if (statusFilter !== "ALL" && order.status !== statusFilter) {
        return false;
      }

      if (!orderMatchesPeriod(order.orderDate, periodFilter)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const orderItems = itemsByOrder.get(order.id) ?? [];
      return [
        order.negotiationNumber,
        ...orderItems.flatMap((item) => [
          item.codeSnapshot,
          item.descriptionSnapshot,
          item.modelSnapshot,
          item.commercialCodeSnapshot,
        ]),
      ].some((value) =>
        value
          ? normalizeSearch(value).includes(normalizedQuery)
          : false,
      );
    });

    return result.sort((first, second) => {
      if (sort === "NUMBER") {
        return compareText(first.negotiationNumber, second.negotiationNumber);
      }

      const dateDifference =
        new Date(`${first.orderDate}T00:00:00`).getTime() -
        new Date(`${second.orderDate}T00:00:00`).getTime();
      const createdDifference =
        new Date(first.createdAt).getTime() -
        new Date(second.createdAt).getTime();

      return sort === "OLDEST"
        ? dateDifference || createdDifference
        : -(dateDifference || createdDifference);
    });
  }, [
    data.summaries,
    itemsByOrder,
    normalizedQuery,
    periodFilter,
    sort,
    statusFilter,
  ]);

  const activeFilterCount =
    (statusFilter !== "ALL" ? 1 : 0) +
    (periodFilter !== "ALL" ? 1 : 0);
  const hasAnyOrders = data.summaries.length > 0;

  const handleMutated = useCallback(
    (message: string, orderId?: string) => {
      setFeedback(message);
      if (orderId) {
        setSelectedOrderId(orderId);
      }
      router.refresh();
    },
    [router],
  );

  function openOrder(orderId: string) {
    setSelectedOrderId(orderId);
    setEditingOrderId(null);
    setCreatingOrder(false);
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-charcoal text-brand-gold">
            <OrdersIcon className="size-5" />
          </span>
          <div>
            <p className="text-[0.68rem] font-black tracking-[0.16em] text-brand-gold-ink uppercase">
              Fornecedores
            </p>
            <h1 className="text-2xl font-black tracking-tight text-text-primary sm:text-3xl">
              Pedidos
            </h1>
            <p className="mt-1 text-sm font-semibold text-text-muted">
              Acompanhe negociações e retiradas no fornecedor.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreatingOrder(true);
            setSelectedOrderId(null);
            setEditingOrderId(null);
          }}
          className="nk-focus inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
        >
          <PlusIcon className="size-5" />
          Novo pedido
        </button>
      </div>

      <section
        className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 lg:grid-cols-4"
        aria-label="Indicadores de pedidos"
      >
        {[
          ["Pendentes", indicators.pending, "bg-amber-50 border-amber-200"],
          ["Parciais", indicators.partial, "bg-sky-50 border-sky-200"],
          [
            "Concluídos",
            indicators.completed,
            "bg-emerald-50 border-emerald-200",
          ],
          [
            "Itens aguardando retirada",
            indicators.waiting,
            "bg-violet-50 border-violet-200",
          ],
        ].map(([label, value, className]) => (
          <article
            key={String(label)}
            className={`rounded-xl border p-2.5 sm:rounded-2xl sm:p-3 ${className}`}
          >
            <p className="text-[0.65rem] font-black tracking-wide text-text-muted uppercase">
              {label}
            </p>
            <p className="mt-0.5 font-mono text-xl font-black text-text-primary sm:mt-1 sm:text-2xl">
              {quantityFormatter.format(Number(value))}
            </p>
          </article>
        ))}
      </section>

      <section className="mt-3 rounded-2xl border border-border-neutral bg-surface p-3 sm:mt-4 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Pesquisar pedido</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Pesquisar pedido, item ou código..."
              className="nk-focus h-12 w-full rounded-xl border border-border-neutral bg-white pr-3 pl-10 text-sm font-semibold text-text-primary"
            />
          </label>
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="supplier-order-filters"
            onClick={() => setFiltersOpen((current) => !current)}
            className="nk-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border-neutral bg-white px-4 text-sm font-black text-text-primary transition hover:bg-app-background"
          >
            Filtros
            {activeFilterCount > 0 ? (
              <span className="rounded-full bg-brand-gold px-2 py-0.5 text-xs text-brand-charcoal">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
        </div>

        {filtersOpen ? (
          <div
            id="supplier-order-filters"
            className="mt-3 grid gap-3 border-t border-border-neutral pt-3 lg:grid-cols-[1fr_auto_auto]"
          >
            <div>
              <p className="mb-1.5 text-[0.65rem] font-black tracking-wide text-text-muted uppercase">
                Status
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  ["ALL", "Todos"],
                  ["PENDING", "Pendentes"],
                  ["PARTIAL", "Parciais"],
                  ["COMPLETED", "Concluídos"],
                  ["CANCELLED", "Cancelados"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={statusFilter === value}
                    onClick={() => setStatusFilter(value as StatusFilter)}
                    className={`nk-focus min-h-10 rounded-xl px-3 text-xs font-black transition ${
                      statusFilter === value
                        ? "bg-brand-charcoal text-white"
                        : "border border-border-neutral bg-white text-text-muted hover:bg-app-background"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label>
              <span className="mb-1.5 block text-[0.65rem] font-black tracking-wide text-text-muted uppercase">
                Período
              </span>
              <select
                value={periodFilter}
                onChange={(event) =>
                  setPeriodFilter(event.target.value as PeriodFilter)
                }
                className="nk-focus h-11 w-full rounded-xl border border-border-neutral bg-white px-3 text-sm font-bold text-text-primary lg:w-48"
              >
                <option value="ALL">Todos os períodos</option>
                <option value="7">Últimos 7 dias</option>
                <option value="30">Últimos 30 dias</option>
                <option value="90">Últimos 90 dias</option>
                <option value="MONTH">Este mês</option>
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-[0.65rem] font-black tracking-wide text-text-muted uppercase">
                Ordenação
              </span>
              <select
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as OrderSort)
                }
                className="nk-focus h-11 w-full rounded-xl border border-border-neutral bg-white px-3 text-sm font-bold text-text-primary lg:w-44"
              >
                <option value="RECENT">Mais recentes</option>
                <option value="OLDEST">Mais antigos</option>
                <option value="NUMBER">Nº do pedido</option>
              </select>
            </label>
          </div>
        ) : null}
      </section>

      {!hasAnyOrders ? (
        <section className="mt-4 rounded-2xl border border-dashed border-border-neutral bg-surface px-5 py-10 text-center">
          <OrdersIcon className="mx-auto size-10 text-brand-gold-dark" />
          <h2 className="mt-3 text-xl font-black text-text-primary">
            Nenhum pedido cadastrado.
          </h2>
          <p className="mt-1 text-sm font-semibold text-text-muted">
            Crie o primeiro pedido para acompanhar as retiradas no fornecedor.
          </p>
          <button
            type="button"
            onClick={() => setCreatingOrder(true)}
            className="nk-focus mt-4 inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-charcoal px-5 text-sm font-black text-white"
          >
            <PlusIcon className="size-5" />
            Novo pedido
          </button>
        </section>
      ) : filteredOrders.length === 0 ? (
        <section className="mt-4 rounded-2xl border border-dashed border-border-neutral bg-surface px-5 py-10 text-center">
          <h2 className="text-lg font-black text-text-primary">
            Nenhum pedido encontrado com os filtros atuais.
          </h2>
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setStatusFilter("ALL");
              setPeriodFilter("ALL");
            }}
            className="nk-focus mt-3 min-h-11 rounded-xl border border-border-neutral px-4 text-sm font-black text-text-primary"
          >
            Limpar filtros
          </button>
        </section>
      ) : (
        <div className="mt-3 max-w-full overflow-hidden rounded-2xl border border-border-neutral bg-surface sm:mt-4 sm:overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-left sm:hidden">
              <colgroup>
                <col className="w-[19%]" />
                <col className="w-[29%]" />
                <col className="w-[16%]" />
                <col className="w-[36%]" />
              </colgroup>
              <thead className="bg-brand-charcoal text-white">
                <tr>
                  {["Data", "Pedido", "Itens", "Situação"].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-1.5 py-2 text-[0.62rem] font-black tracking-wide uppercase"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr
                    key={order.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Abrir pedido ${order.negotiationNumber}`}
                    onClick={() => openOrder(order.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openOrder(order.id);
                      }
                    }}
                    className="nk-focus cursor-pointer border-t border-border-neutral align-top transition hover:bg-brand-gold-soft/30 focus:bg-brand-gold-soft/30"
                  >
                    <td className="whitespace-nowrap px-1.5 py-2.5 text-[0.68rem] font-bold text-text-primary">
                      {formatCompactOrderDate(order.orderDate)}
                    </td>
                    <td className="px-1.5 py-2.5">
                      <span className="line-clamp-2 [overflow-wrap:anywhere] font-mono text-xs leading-4 font-black text-text-primary">
                        {order.negotiationNumber}
                      </span>
                    </td>
                    <td className="px-1.5 py-2.5 text-xs text-text-primary">
                      <strong>
                        {quantityFormatter.format(order.orderedQuantity)} un.
                      </strong>
                      <span className="mt-0.5 block text-[0.6rem] leading-tight font-semibold text-text-muted">
                        {quantityFormatter.format(order.lineCount)} tipos
                      </span>
                    </td>
                    <td className="px-1.5 py-2">
                      <MobileOrderSituation order={order} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <table className="hidden w-full min-w-[680px] border-collapse text-left sm:table">
              <thead className="bg-brand-charcoal text-white">
                <tr>
                  <th
                    scope="col"
                    className="px-2 py-2.5 text-xs font-black tracking-wide uppercase sm:px-4 sm:py-3"
                  >
                    Data
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-2.5 text-xs font-black tracking-wide uppercase sm:px-4 sm:py-3"
                  >
                    <span className="sm:hidden">Pedido</span>
                    <span className="hidden sm:inline">Nº do pedido</span>
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-2.5 text-xs font-black tracking-wide uppercase sm:px-4 sm:py-3"
                  >
                    <span className="sm:hidden">Itens</span>
                    <span className="hidden sm:inline">Total de itens</span>
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-2.5 text-xs font-black tracking-wide uppercase sm:px-4 sm:py-3"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-2.5 text-xs font-black tracking-wide uppercase sm:px-4 sm:py-3"
                  >
                    Progresso
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr
                    key={order.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Abrir pedido ${order.negotiationNumber}`}
                    onClick={() => openOrder(order.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openOrder(order.id);
                      }
                    }}
                    className="nk-focus cursor-pointer border-t border-border-neutral transition hover:bg-brand-gold-soft/30 focus:bg-brand-gold-soft/30"
                  >
                    <td className="px-2 py-2.5 text-sm font-bold text-text-primary sm:px-4 sm:py-3">
                      <span className="sm:hidden">
                        {formatCompactOrderDate(order.orderDate)}
                      </span>
                      <span className="hidden sm:inline">
                        {formatOrderDate(order.orderDate)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 font-mono text-sm font-black text-text-primary sm:px-4 sm:py-3">
                      {order.negotiationNumber}
                    </td>
                    <td className="px-2 py-2.5 text-sm text-text-primary sm:px-4 sm:py-3">
                      <strong>
                        {quantityFormatter.format(order.orderedQuantity)} un.
                      </strong>
                      <span className="block text-xs font-semibold text-text-muted">
                        {quantityFormatter.format(order.lineCount)} itens
                      </span>
                    </td>
                    <td className="px-2 py-2.5 sm:px-4 sm:py-3">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-2 py-2.5 sm:px-4 sm:py-3">
                      <PickupProgress order={order} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      )}

      {creatingOrder ? (
        <OrderFormDialog
          mode="CREATE"
          order={null}
          initialItems={[]}
          events={[]}
          catalog={data.catalog}
          onClose={() => setCreatingOrder(false)}
          onStale={(message) => {
            setCreatingOrder(false);
            setFeedback(message);
            router.refresh();
          }}
          onSaved={(_orderId, message) => {
            setCreatingOrder(false);
            handleMutated(message);
          }}
        />
      ) : null}

      {editingOrder ? (
        <OrderFormDialog
          key={`${editingOrder.id}:${editingOrder.updatedAt}`}
          mode="EDIT"
          order={editingOrder}
          initialItems={itemsByOrder.get(editingOrder.id) ?? []}
          events={eventsByOrder.get(editingOrder.id) ?? []}
          catalog={data.catalog}
          onClose={() => setEditingOrderId(null)}
          onStale={(message) => {
            setEditingOrderId(null);
            setFeedback(message);
            router.refresh();
          }}
          onSaved={(orderId, message) => {
            setEditingOrderId(null);
            handleMutated(message, orderId);
          }}
        />
      ) : null}

      {selectedOrder && !editingOrder ? (
        <OrderDetailsDialog
          key={`${selectedOrder.id}:${selectedOrder.updatedAt}`}
          order={selectedOrder}
          items={itemsByOrder.get(selectedOrder.id) ?? []}
          onClose={() => setSelectedOrderId(null)}
          onEdit={() => setEditingOrderId(selectedOrder.id)}
          onMutated={(message) => handleMutated(message, selectedOrder.id)}
        />
      ) : null}

      {feedback ? (
        <div
          role="status"
          className="fixed right-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] left-3 z-[120] mx-auto flex max-w-md items-start justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950 shadow-xl lg:right-5 lg:left-auto"
        >
          <span>{feedback}</span>
          <button
            type="button"
            aria-label="Fechar confirmação"
            onClick={() => setFeedback(null)}
            className="nk-focus shrink-0 rounded px-1 font-black"
          >
            ×
          </button>
        </div>
      ) : null}
    </>
  );
}
