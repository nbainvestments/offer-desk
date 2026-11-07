import type { ConditionTier } from "./config";

export type PropertyType = "sfr" | "multi" | "condo" | "townhouse" | "mobile" | "land" | "other";

export interface Listing {
  mlsNumber: string;
  address: string;
  city: string;
  zip?: string;
  lat?: number;
  lon?: number;
  listPrice: number;
  originalListPrice?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  yearBuilt?: number;
  propertyType: PropertyType;
  remarks: string;
  dom?: number;
  listDate?: string;
  event: "new" | "price_change" | "back_on_market" | "expired" | "withdrawn" | "sold" | "other";
  agentName?: string;
  agentEmail?: string;
  agentPhone?: string;
  hoaMonthly?: number;
  age55?: boolean; // 55+ / active adult community
  photoUrls: string[];
  sourceUrl?: string;
}

export interface SoldComp {
  mlsNumber?: string;
  address: string;
  lat: number;
  lon: number;
  beds: number;
  baths?: number;
  sqft: number;
  propertyType: PropertyType;
  age55?: boolean;
  salePrice: number;
  closeDate: string; // ISO
  remarks?: string;
  older?: boolean; // 91–180 days old (backup comp)
}

export interface PhotoAssessment {
  tier: ConditionTier | "unknown";
  hasInterior: boolean;
  confidence: number; // 0-1
  notes: string;
}
