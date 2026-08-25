import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { refreshAccessToken, listAccessibleCustomers, queryCustomer } from "@/lib/googleAdsClient";

export const maxDuration = 30;

async function getAccessToken(): Promise<string> {
  const cookieStore = await cookies();
  const raw = cookieStore.get("google_ads_tokens")?.value;
  if (!raw) throw new Error("Not connected");
  const tokens = JSON.parse(raw);
  if (Date.now() > tokens.expiry - 60000) {
    return await refreshAccessToken(tokens.refresh_token);
  }
  return tokens.access_token;
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = await getAccessToken();
    const customerIds = await listAccessibleCustomers(accessToken);

    const accounts = await Promise.all(
      customerIds.map(async (id) => {
        try {
          const results = await queryCustomer(accessToken, id,
            `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status FROM customer LIMIT 1`
          );
          const c = results[0]?.customer;
          if (!c) return null;
          return {
            id,
            name: c.descriptive_name || `Account ${id}`,
            currency: c.currency_code || "USD",
            timeZone: c.time_zone || "",
            status: c.status || "ENABLED",
          };
        } catch {
          return { id, name: `Account ${id}`, currency: "USD", timeZone: "", status: "UNKNOWN" };
        }
      })
    );

    return NextResponse.json({ success: true, accounts: accounts.filter(Boolean) });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Not connected")) {
      return NextResponse.json({ success: false, error: "not_connected" }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
