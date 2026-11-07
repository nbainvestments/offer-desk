import type { ConditionTier } from "./config";

export type PropertyType = "sfr" | "multi" | "condo" | "townhouse" | "land" | "other";

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
  photoUrls: string[];
  sourceUrl?: string;
}

export interface SoldComp {
  mlsNumber?: string;
  address: string;
  lat: number;
  lon: number;
  beds: number;
  sqft: number;
  propertyType: PropertyType;
  salePrice: number;
  closeDate: string; // ISO
  remarks?: string;
}

export interface PhotoAssessment {
  tier: ConditionTier | "unknown";
  hasInterior: boolean;
  confidence: number; // 0-1
  notes: string;
}
