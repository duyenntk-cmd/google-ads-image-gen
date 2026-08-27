/**
 * Google Ads API client helpers
 * Uses OAuth2 refresh token flow
 */

const GOOGLE_ADS_API_VERSION = "v17";
const BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const REST_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

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

export function adsHeaders(accessToken: string, loginCustomerId?: string) {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    "Content-Type": "application/json",
  };
  const mcc = loginCustomerId || process.env.GOOGLE_ADS_MCC_CUSTOMER_ID;
  if (mcc) h["login-customer-id"] = mcc.replace(/-/g, "");
  return h;
}

/** List accessible customers - tries MCC account query first, falls back to listAccessibleCustomers */
export async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const mccId = (process.env.GOOGLE_ADS_MCC_CUSTOMER_ID || "").replace(/-/g, "");

  if (mccId) {
    const results = await queryCustomer(accessToken, mccId,
      `SELECT customer_client.client_customer, customer_client.descriptive_name, customer_client.id, customer_client.level FROM customer_client WHERE customer_client.level = 1`
    );
    return results.map((r) => String(r.customer_client?.id || "").replace("customers/", "")).filter(Boolean);
  }

  const res = await fetch(`${BASE_URL}/customers:listAccessibleCustomers`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    },
  });
  const text = await res.text();
  let data: { resourceNames?: string[]; error?: unknown };
  try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON (${res.status}): ${text.slice(0, 200)}`); }
  if (!res.ok) throw new Error(`listAccessibleCustomers ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return (data.resourceNames || []).map((r: string) => r.replace("customers/", ""));
}

/** Get customer info via GAQL */
export async function queryCustomer(accessToken: string, customerId: string, gaql: string) {
  const res = await fetch(`${BASE_URL}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: adsHeaders(accessToken),
    body: JSON.stringify({ query: gaql }),
  });
  const text = await res.text();
  let data: { results?: unknown[]; error?: { message: string } };
  try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 300)}`); }
  if (!res.ok) throw new Error(`Query error ${res.status}: ${JSON.stringify(data)}`);
  return (data.results || []) as Record<string, Record<string, string>>[];
}

/** Create a mutate request */
export async function mutate(accessToken: string, customerId: string, operations: object[]) {
  const res = await fetch(`${BASE_URL}/customers/${customerId}/googleAds:mutate`, {
    method: "POST",
    headers: adsHeaders(accessToken),
    body: JSON.stringify({ mutateOperations: operations }),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 300)}`); }
  if (!res.ok) throw new Error(`Mutate error ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

/** Upload image asset */
export async function uploadImageAsset(
  accessToken: string,
  customerId: string,
  base64Data: string,
  name: string
): Promise<string> {
  const imageData = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
  const res = await fetch(`${BASE_URL}/customers/${customerId}/googleAds:mutate`, {
    method: "POST",
    headers: adsHeaders(accessToken),
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
  const text = await res.text();
  let data: { mutateOperationResponses?: { assetResult?: { resourceName: string } }[] };
  try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 300)}`); }
  if (!res.ok) throw new Error(`Upload error ${res.status}: ${text.slice(0, 300)}`);
  return data.mutateOperationResponses?.[0]?.assetResult?.resourceName || "";
}


