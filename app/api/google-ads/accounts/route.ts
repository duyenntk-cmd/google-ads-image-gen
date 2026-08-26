import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { refreshAccessToken, listAccessibleCustomers, queryCustomer } from "@/lib/googleAdsClient";

export const maxDuration = 30;

async function getTokens() {
  const cookieStore = await cookies();
  const raw = cookieStore.get("google_ads_tokens")?.value;
  if (!raw) throw new Error("not_connected");
  return JSON.parse(raw);
}

async function getAccessToken(): Promise<string> {
  const tokens = await getTokens();
  if (Date.now() > tokens.expiry - 60000) {
    return await refreshAccessToken(tokens.refresh_token);
  }
  return tokens.access_token;
}

export async function GET(req: NextRequest) {
  try {
    void req;
    const accessToken = await getAccessToken();

    let customerIds: string[] = [];
    try {
      customerIds = await listAccessibleCustomers(accessToken);
    } catch (e) {
      console.error("listAccessibleCustomers error:", e);
      return NextResponse.json({ success: false, error: `listAccessibleCustomers failed: ${String(e)}` }, { status: 500 });
    }

    if (customerIds.length === 0) {
      return NextResponse.json({ success: true, accounts: [] });
    }

    const accounts = await Promise.all(
      customerIds.map(async (id) => {
        try {
          const results = await queryCustomer(accessToken, id,
            `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status FROM customer LIMIT 1`
          );
          const c = results[0]?.customer;
          if (!c) return { id, name: `Account ${id}`, currency: "VND", timeZone: "Asia/Ho_Chi_Minh", status: "ENABLED" };
          return {
            id,
            name: c.descriptive_name || `Account ${id}`,
            currency: c.currency_code || "VND",
            timeZone: c.time_zone || "",
            status: c.status || "ENABLED",
          };
        } catch {
          return { id, name: `Account ${id}`, currency: "VND", timeZone: "", status: "UNKNOWN" };
        }
      })
    );

    return NextResponse.json({ success: true, accounts: accounts.filter(Boolean) });
  } catch (err) {
    const msg = String(err);
    console.error("accounts route error:", msg);
    if (msg.includes("not_connected")) {
      return NextResponse.json({ success: false, error: "not_connected" }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
