import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateListingIntakeExit,
  evaluateActiveMarketExit,
  evaluateEscrowClosingExit,
  validatePropertyListingAttributes,
  type PropertyListing,
} from "../src/index.ts";

const validListing: PropertyListing = {
  listingId: "listing_001",
  tenantId: "tenant_realtors_01",
  brokerageAccountId: "acc_brokerage_01",
  sellerContactId: "contact_seller_01",
  buyerContactId: "contact_buyer_01",
  representationAgreementId: "agr_listing_01",
  propertyAddress: "742 Evergreen Terrace, Springfield, OR",
  description: "Beautiful 4-bedroom single family home with spacious yard.",
  priority: "NORMAL",
  status: "OPEN",
  stage: "LISTING_INTAKE",
  schemaVersion: 1,
  attributes: {
    propertyType: "RESIDENTIAL",
    listingPriceMinorUnits: 45000000, // $450,000.00
    squareFeet: 2200,
    bedrooms: 4,
    bathrooms: 2.5,
    mlsNumber: "MLS-987654",
    earnestMoneyDepositMinorUnits: 1000000, // $10,000.00
  },
};

test("validatePropertyListingAttributes accepts valid residential listing", () => {
  const result = validatePropertyListingAttributes(validListing.attributes);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validatePropertyListingAttributes rejects negative listing price", () => {
  const result = validatePropertyListingAttributes({
    ...validListing.attributes,
    listingPriceMinorUnits: -100,
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("INVALID_LISTING_PRICE"));
});

test("evaluateListingIntakeExit requires brokerage, seller, agreement, and address", () => {
  const check = evaluateListingIntakeExit(validListing);
  assert.equal(check.canTransition, true);
  assert.equal(check.blockers.length, 0);

  const missingAgreement = evaluateListingIntakeExit({
    ...validListing,
    representationAgreementId: null,
  });
  assert.equal(missingAgreement.canTransition, false);
  assert.ok(missingAgreement.blockers.includes("REPRESENTATION_AGREEMENT_REQUIRED"));
});

test("evaluateActiveMarketExit requires accepted purchase offer and earnest money deposit", () => {
  const check = evaluateActiveMarketExit(validListing, {
    acceptedOfferAmountMinorUnits: 44500000,
    earnestMoneyReceived: true,
  });
  assert.equal(check.canTransition, true);

  const noDeposit = evaluateActiveMarketExit(validListing, {
    acceptedOfferAmountMinorUnits: 44500000,
    earnestMoneyReceived: false,
  });
  assert.equal(noDeposit.canTransition, false);
  assert.ok(noDeposit.blockers.includes("EARNEST_MONEY_DEPOSIT_REQUIRED"));
});

test("evaluateEscrowClosingExit requires title search, contingency clearance and closing funds", () => {
  const check = evaluateEscrowClosingExit(validListing, {
    titleSearchCleared: true,
    inspectionContingencyWaived: true,
    closingFundsDisbursed: true,
  });
  assert.equal(check.canTransition, true);

  const unclearedTitle = evaluateEscrowClosingExit(validListing, {
    titleSearchCleared: false,
    inspectionContingencyWaived: true,
    closingFundsDisbursed: true,
  });
  assert.equal(unclearedTitle.canTransition, false);
  assert.ok(unclearedTitle.blockers.includes("TITLE_SEARCH_CLEARANCE_REQUIRED"));
});
