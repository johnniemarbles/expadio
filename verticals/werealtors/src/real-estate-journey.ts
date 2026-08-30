import type {
  PropertyListing,
  ListingStage,
} from "./listing.ts";

export interface RealEstateStageTransitionCheck {
  readonly canTransition: boolean;
  readonly blockers: readonly string[];
}

export function evaluateListingIntakeExit(listing: PropertyListing): RealEstateStageTransitionCheck {
  const blockers: string[] = [];

  if (!listing.brokerageAccountId) {
    blockers.push("BROKERAGE_ACCOUNT_REQUIRED");
  }
  if (!listing.sellerContactId) {
    blockers.push("SELLER_CONTACT_REQUIRED");
  }
  if (!listing.representationAgreementId) {
    blockers.push("REPRESENTATION_AGREEMENT_REQUIRED");
  }
  if (!listing.propertyAddress || listing.propertyAddress.trim() === "") {
    blockers.push("PROPERTY_ADDRESS_REQUIRED");
  }
  if (listing.attributes.listingPriceMinorUnits <= 0) {
    blockers.push("POSITIVE_LISTING_PRICE_REQUIRED");
  }

  return {
    canTransition: blockers.length === 0,
    blockers,
  };
}

export function evaluateActiveMarketExit(
  listing: PropertyListing,
  offer: {
    readonly acceptedOfferAmountMinorUnits: number;
    readonly earnestMoneyReceived: boolean;
  }
): RealEstateStageTransitionCheck {
  const blockers: string[] = [];

  if (!listing.buyerContactId) {
    blockers.push("BUYER_CONTACT_REQUIRED");
  }
  if (offer.acceptedOfferAmountMinorUnits <= 0) {
    blockers.push("VALID_PURCHASE_OFFER_REQUIRED");
  }
  if (!offer.earnestMoneyReceived) {
    blockers.push("EARNEST_MONEY_DEPOSIT_REQUIRED");
  }

  return {
    canTransition: blockers.length === 0,
    blockers,
  };
}

export function evaluateEscrowClosingExit(
  listing: PropertyListing,
  settlement: {
    readonly titleSearchCleared: boolean;
    readonly inspectionContingencyWaived: boolean;
    readonly closingFundsDisbursed: boolean;
  }
): RealEstateStageTransitionCheck {
  const blockers: string[] = [];

  if (!settlement.titleSearchCleared) {
    blockers.push("TITLE_SEARCH_CLEARANCE_REQUIRED");
  }
  if (!settlement.inspectionContingencyWaived) {
    blockers.push("INSPECTION_CONTINGENCY_CLEARANCE_REQUIRED");
  }
  if (!settlement.closingFundsDisbursed) {
    blockers.push("CLOSING_FUNDS_DISBURSEMENT_REQUIRED");
  }

  return {
    canTransition: blockers.length === 0,
    blockers,
  };
}
