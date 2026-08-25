/**
 * Google Ads API client helpers
 * Uses OAuth2 refresh token flow
 */

const GOOGLE_ADS_API_VERSION = "v18";
const BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

export interface GoogleAdsTokens {
  access_token: string;
  refresh_token: string;
  expiry: number; // unix ms
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

export function adsHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    "Content-Type": "application/json",
  };
}

/** List accessible customers under MCC */
export async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/customers:listAccessibleCustomers`, {
    headers: adsHeaders(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return (data.resourceNames || []).map((r: string) => r.replace("customers/", ""));
}

/** Get customer info via GAQL */
export async function queryCustomer(accessToken: string, customerId: string, gaql: string) {
  const res = await fetch(`${BASE_URL}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: {
      ...adsHeaders(accessToken),
      "login-customer-id": process.env.GOOGLE_ADS_MCC_CUSTOMER_ID!,
    },
    body: JSON.stringify({ query: gaql }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.results || [];
}

/** Create a mutate request (campaigns, ad groups, assets, etc.) */
export async function mutate(accessToken: string, customerId: string, operations: object[]) {
  const res = await fetch(`${BASE_URL}/customers/${customerId}/googleAds:mutate`, {
    method: "POST",
    headers: {
      ...adsHeaders(accessToken),
      "login-customer-id": process.env.GOOGLE_ADS_MCC_CUSTOMER_ID!,
    },
    body: JSON.stringify({ mutateOperations: operations }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

/** Upload image asset */
export async function uploadImageAsset(
  accessToken: string,
  customerId: string,
  base64Data: string,
  name: string
): Promise<string> {
  // Strip data URL prefix if present
  const imageData = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
  const res = await fetch(`${BASE_URL}/customers/${customerId}/googleAds:mutate`, {
    method: "POST",
    headers: {
      ...adsHeaders(accessToken),
      "login-customer-id": process.env.GOOGLE_ADS_MCC_CUSTOMER_ID!,
    },
    body: JSON.stringify({
      mutateOperations: [{
        assetOperation: {
          create: {
            name,
            type: "IMAGE",
            imageAsset: { data: imageData },
          },
        },
      }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.mutateOperationResponses[0].assetResult.resourceName;
}
