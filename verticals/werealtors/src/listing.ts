import type { CasePriority, CaseStatus } from "@expadio/case";

export const WEREALTORS_WORK_TYPE_KEY = "crm.case" as const;
export const WEREALTORS_VERTICAL_KEY = "werealtors" as const;

export type PropertyType = "RESIDENTIAL" | "COMMERCIAL" | "LAND" | "INDUSTRIAL";

export type ListingStage =
  | "LISTING_INTAKE"
  | "ACTIVE_MARKET"
  | "UNDER_CONTRACT"
  | "ESCROW_CLOSING"
  | "CLOSED";

export interface PropertyListingAttributes {
  readonly propertyType: PropertyType;
  readonly listingPriceMinorUnits: number;
  readonly squareFeet?: number;
  readonly bedrooms?: number;
  readonly bathrooms?: number;
  readonly mlsNumber?: string;
  readonly earnestMoneyDepositMinorUnits?: number;
}

export interface PropertyListing {
  readonly listingId: string;
  readonly tenantId: string;
  readonly brokerageAccountId: string | null;
  readonly sellerContactId: string | null;
  readonly buyerContactId: string | null;
  readonly representationAgreementId: string | null;
  readonly propertyAddress: string;
  readonly description: string | null;
  readonly priority: CasePriority;
  readonly status: CaseStatus;
  readonly stage: ListingStage | null;
  readonly schemaVersion: number;
  readonly attributes: PropertyListingAttributes;
}

export function validatePropertyListingAttributes(
  attributes: PropertyListingAttributes
): { readonly valid: boolean; readonly errors: readonly string[] } {
  const errors: string[] = [];

  if (!["RESIDENTIAL", "COMMERCIAL", "LAND", "INDUSTRIAL"].includes(attributes.propertyType)) {
    errors.push("INVALID_PROPERTY_TYPE");
  }

  if (
    !Number.isInteger(attributes.listingPriceMinorUnits) ||
    attributes.listingPriceMinorUnits <= 0
  ) {
    errors.push("INVALID_LISTING_PRICE");
  }

  if (
    attributes.earnestMoneyDepositMinorUnits !== undefined &&
    (!Number.isInteger(attributes.earnestMoneyDepositMinorUnits) ||
      attributes.earnestMoneyDepositMinorUnits < 0)
  ) {
    errors.push("INVALID_EARNEST_MONEY_DEPOSIT");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
