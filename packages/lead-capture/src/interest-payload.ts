/**
 * Typed Demand Capture field bags for commercial interest workflows.
 *
 * These types deliberately live in @expadio/lead-capture rather than the
 * postgres runtime. Capture surfaces must be able to build a submission without
 * depending on database/runtime packages. The discriminants mirror the current
 * EnterpriseAppointmentKind values used by the enterprise domain.
 *
 * Tier 1: identity/business/location are collected at initial capture.
 * Tier 2: self-declared qualification data is collected at capture and can seed
 *         lead_qualifications/scoring after persistence.
 * Tier 3 evidence/compliance is intentionally separate and will be stage-gated.
 */

export type CaptureInterestType =
  | 'FRANCHISEE'
  | 'MASTER_FRANCHISEE'
  | 'DISTRIBUTOR'
  | 'AFFILIATE'
  | 'LICENSEE'
  | 'AGENT';

export interface CapturePersonDetail {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone?: string;
  readonly whatsappPhone?: string;
  readonly city?: string;
  readonly regionOrState?: string;
  readonly postalCode?: string;
  readonly countryCode?: string;
  readonly preferredLanguage?: string;
  readonly preferredContactMethod?: 'EMAIL' | 'PHONE' | 'SMS' | 'WHATSAPP';
  readonly preferredContactTime?: string;
  readonly linkedinUrl?: string;
}

export interface CaptureBusinessProfile {
  readonly hasExistingBusiness: boolean;
  readonly companyName?: string;
  readonly tradingName?: string;
  readonly companyWebsite?: string;
  readonly roleTitle?: string;
  readonly yearsInBusiness?: number;
  readonly legalForm?: 'LLC' | 'LTD' | 'CORP' | 'PTE_LTD' | 'PARTNERSHIP' | 'SOLE_TRADER' | 'OTHER';
  readonly industry?: string;
  readonly businessDescription?: string;
  readonly employeeCountRange?: string;
  readonly annualRevenueRange?: string;
  readonly numberOfLocations?: number;
  readonly countriesServed?: readonly string[];
  readonly regionsServed?: readonly string[];
  readonly brandsRepresented?: readonly string[];
  readonly ownsOtherFranchises?: boolean;
  readonly existingFranchiseBrands?: readonly string[];
}

export interface CaptureSitePreference {
  readonly address?: string;
  readonly ownership?: 'OWNED' | 'LEASED' | 'NEGOTIATING' | 'UNKNOWN';
  readonly sizeSqFt?: number;
}

export interface CaptureLocationPreference {
  readonly countryCode: string;
  readonly regionOrState?: string;
  readonly city?: string;
  readonly postalCode?: string;
  readonly territoryType?: 'COUNTRY' | 'REGION' | 'STATE' | 'CITY' | 'METRO' | 'POSTAL_AREA' | 'CUSTOM';
  readonly territoryName?: string;
  readonly exclusivitySought?: boolean;
  readonly numberOfLocations?: number;
  readonly priority?: number;
  readonly willingToConsiderAlternatives?: boolean;
  readonly siteIdentified?: boolean;
  readonly site?: CaptureSitePreference;
}

export interface CaptureInterestBase {
  readonly interestType: CaptureInterestType;
  readonly person: CapturePersonDetail;
  readonly locationSought: readonly CaptureLocationPreference[];
}

export type FranchiseOpportunityType =
  | 'SINGLE_UNIT'
  | 'MULTI_UNIT'
  | 'AREA_DEVELOPMENT'
  | 'CONVERSION'
  | 'RESALE';

export interface FranchiseePayload extends CaptureInterestBase {
  readonly interestType: 'FRANCHISEE';
  readonly opportunityType: FranchiseOpportunityType;
  readonly business: CaptureBusinessProfile;
  readonly investmentBudgetMinorUnits?: number;
  readonly availableLiquidCapitalMinorUnits?: number;
  readonly estimatedNetWorthMinorUnits?: number;
  readonly financingRequired?: boolean;
  readonly fundingSources?: readonly ('PERSONAL_FUNDS' | 'BANK_FINANCE' | 'PARTNER' | 'INVESTOR' | 'OTHER')[];
  readonly businessOwnershipExperienceYears?: number;
  readonly managementExperienceYears?: number;
  readonly franchiseExperienceYears?: number;
  readonly industryExperienceYears?: number;
  readonly hasRetailExperience?: boolean;
  readonly intendedRole?: 'OWNER_OPERATOR' | 'INVESTOR' | 'OPERATING_PARTNER' | 'MULTI_UNIT_OPERATOR';
  readonly numberOfUnitsDesired?: number;
  readonly preferredOpeningTimeline?: 'IMMEDIATE' | '3_MONTHS' | '6_MONTHS' | '12_MONTHS' | 'FLEXIBLE';
  readonly motivation?: string;
}

export interface MasterFranchiseDevelopmentTarget {
  readonly year: number;
  readonly unitTarget: number;
}

export interface MasterFranchiseePayload extends CaptureInterestBase {
  readonly interestType: 'MASTER_FRANCHISEE';
  readonly business: CaptureBusinessProfile;
  readonly investmentBudgetMinorUnits?: number;
  readonly availableLiquidCapitalMinorUnits?: number;
  readonly estimatedTerritoryInvestmentMinorUnits?: number;
  readonly territorySought: string;
  readonly subFranchiseNetworkTarget?: number;
  readonly developmentSchedule?: readonly MasterFranchiseDevelopmentTarget[];
  readonly hasNetworkManagementExperience: boolean;
  readonly hasFranchiseRecruitmentExperience?: boolean;
  readonly hasTrainingInfrastructure?: boolean;
  readonly hasFieldSupportCapability?: boolean;
  readonly existingOperationalTeamSize?: number;
  readonly existingSalesTeamSize?: number;
  readonly countriesCurrentlyOperating?: readonly string[];
}

export type DistributionOpportunityType =
  | 'EXCLUSIVE_DISTRIBUTOR'
  | 'NON_EXCLUSIVE_DISTRIBUTOR'
  | 'MASTER_DISTRIBUTOR'
  | 'SUB_DISTRIBUTOR';

export interface DistributorPayload extends CaptureInterestBase {
  readonly interestType: 'DISTRIBUTOR';
  readonly opportunityType?: DistributionOpportunityType;
  readonly business: CaptureBusinessProfile;
  readonly productCategories?: readonly string[];
  readonly existingDistributionChannels?: readonly string[];
  readonly currentBrandsRepresented?: readonly string[];
  readonly activeCustomerCount?: number;
  readonly targetRetailOutlets?: number;
  readonly salesTeamSize?: number;
  readonly warehouseCapacity?: 'SMALL' | 'MEDIUM' | 'LARGE';
  readonly warehouseLocations?: readonly CaptureLocationPreference[];
  readonly hasDeliveryFleet?: boolean;
  readonly hasThirdPartyLogistics?: boolean;
  readonly hasImportCapability?: boolean;
  readonly hasExportCapability?: boolean;
  readonly importLicenseDetails?: string;
  readonly estimatedInitialOrderMinorUnits?: number;
  readonly estimatedAnnualPurchaseMinorUnits?: number;
  readonly exclusivitySought?: boolean;
}

export interface AffiliatePayload extends CaptureInterestBase {
  readonly interestType: 'AFFILIATE';
  readonly websiteOrPlatform?: string;
  readonly audienceSize?: number;
  readonly audienceCountries?: readonly string[];
  readonly monthlyTraffic?: number;
  readonly emailSubscriberCount?: number;
  readonly primaryChannel?: 'SOCIAL_MEDIA' | 'BLOG' | 'EMAIL' | 'INFLUENCER' | 'MARKETPLACE' | 'OTHER';
  readonly niche?: string;
  readonly promotionMethods?: readonly string[];
  readonly expectedMonthlyReferrals?: number;
  readonly usesPaidAdvertising?: boolean;
  readonly existingAffiliatePrograms?: readonly string[];
}

export interface LicenseePayload extends CaptureInterestBase {
  readonly interestType: 'LICENSEE';
  readonly business: CaptureBusinessProfile;
  readonly licenseUsageIntent: string;
  readonly intendedTerritory: string;
  readonly royaltyModelPreference?: 'FIXED' | 'PERCENTAGE' | 'HYBRID';
  readonly manufacturingCapacityDescription?: string;
  readonly annualProductionCapacity?: number;
  readonly distributionCapacityDescription?: string;
  readonly hasRequiredOperatingLicenses?: boolean;
  readonly qualityCertifications?: readonly string[];
}

export interface AgentPayload extends CaptureInterestBase {
  readonly interestType: 'AGENT';
  readonly business?: CaptureBusinessProfile;
  readonly existingPortfolio?: string;
  readonly targetSectorOrIndustry?: string;
  readonly customerNetworkDescription?: string;
  readonly expectedAnnualSalesMinorUnits?: number;
  readonly exclusivitySought?: boolean;
  readonly commissionModelPreference?: 'PERCENTAGE' | 'FIXED' | 'HYBRID';
}

export type CaptureInterestPayload =
  | FranchiseePayload
  | MasterFranchiseePayload
  | DistributorPayload
  | AffiliatePayload
  | LicenseePayload
  | AgentPayload;
