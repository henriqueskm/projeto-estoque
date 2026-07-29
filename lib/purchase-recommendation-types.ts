import type { PhysicalStockItemType } from "@/lib/stock-calculations";
import type {
  SupplierOrderClosureKind,
  SupplierOrderStatus,
} from "@/lib/supplier-orders-types";

export type PurchaseRecommendationTargetKind =
  | "item"
  | "commercial_configuration";

export type PurchaseRecommendationItemType =
  | PhysicalStockItemType
  | "COMPLETE_BOX";

export type PurchaseRecommendationGroup =
  | "BUY_NOW"
  | "ALREADY_ORDERED"
  | "MISSING_MINIMUM"
  | "NO_ACTION";

export type PurchaseRecommendationCoverage =
  | "SUFFICIENT"
  | "INSUFFICIENT";

export type PurchaseRecommendationOrder = {
  orderId: string;
  negotiationNumber: string;
  orderDate: string;
  status: SupplierOrderStatus;
  closureKind: SupplierOrderClosureKind | null;
  codeSnapshot: string;
  pendingQuantity: number;
  href: string;
};

export type PurchaseRecommendationItem = {
  targetKind: PurchaseRecommendationTargetKind;
  targetId: string;
  primaryCode: string;
  aliases: string[];
  itemType: PurchaseRecommendationItemType;
  typeLabel: string;
  description: string;
  currentStock: number;
  minimumStock: number | null;
  pendingPurchaseQuantity: number;
  projectedStock: number | null;
  shortfall: number | null;
  recommendedQuantity: number | null;
  remainingGap: number | null;
  coverage: PurchaseRecommendationCoverage | null;
  group: PurchaseRecommendationGroup;
  inventoryHref: string;
  relatedOrders: PurchaseRecommendationOrder[];
};

export type PurchaseRecommendationSummary = {
  buyNowCount: number;
  alreadyOrderedCount: number;
  missingMinimumCount: number;
};

export type PurchaseRecommendationsData = {
  buyNow: PurchaseRecommendationItem[];
  alreadyOrdered: PurchaseRecommendationItem[];
  missingMinimum: PurchaseRecommendationItem[];
  allItems: PurchaseRecommendationItem[];
  summary: PurchaseRecommendationSummary;
};

export type PurchaseRecommendationsResult =
  | { data: PurchaseRecommendationsData; error: null }
  | { data: null; error: string };

export type PurchaseRecommendationCatalogTarget = {
  targetKind: PurchaseRecommendationTargetKind;
  targetId: string;
  primaryCode: string;
  aliases: string[];
  itemType: PurchaseRecommendationItemType;
  typeLabel: string;
  description: string;
  currentStock: number;
  minimumStock: number;
  inventoryHref: string;
};

export type PurchaseRecommendationPendingLine = {
  targetKind: PurchaseRecommendationTargetKind;
  targetId: string;
  orderId: string;
  negotiationNumber: string;
  orderDate: string;
  status: SupplierOrderStatus;
  closureKind: SupplierOrderClosureKind | null;
  isInHistory: boolean;
  codeSnapshot: string;
  waitingPickupQuantity: number;
  waitingStockQuantity: number;
};
