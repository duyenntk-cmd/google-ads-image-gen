import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { refreshAccessToken, queryCustomer, mutate, uploadImageAsset } from "@/lib/googleAdsClient";

export const maxDuration = 60;

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

// GET: list campaigns for an account
export async function GET(req: NextRequest) {
  try {
    const customerId = new URL(req.url).searchParams.get("customerId");
    if (!customerId) return NextResponse.json({ success: false, error: "Missing customerId" }, { status: 400 });

    const accessToken = await getAccessToken();
    const results = await queryCustomer(accessToken, customerId, `
      SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
             campaign.start_date, campaign_budget.amount_micros
      FROM campaign
      WHERE campaign.advertising_channel_type = 'MULTI_CHANNEL'
      ORDER BY campaign.id DESC LIMIT 20
    `);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const campaigns = results.map((r: any) => ({
      id: r.campaign?.id,
      name: r.campaign?.name,
      status: r.campaign?.status,
      startDate: r.campaign?.start_date,
      budgetPerDay: r.campaign_budget ? Math.round(Number(r.campaign_budget.amount_micros) / 1_000_000) : 0,
    }));

    return NextResponse.json({ success: true, campaigns });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// POST: create App Campaign
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      customerId,
      campaignName,
      appId,
      appStore, // "GOOGLE_APP_STORE" | "APPLE_APP_STORE"
      budgetPerDayVnd, // VND
      headlines,     // string[] max 5, each ≤30 chars
      descriptions,  // string[] max 5, each ≤90 chars
      imageDataUrls, // base64 data URLs of banners
      startDate,     // "YYYY-MM-DD"
    } = body;

    if (!customerId || !campaignName || !appId || !budgetPerDayVnd) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    const accessToken = await getAccessToken();

    // 1. Upload image assets
    const imageResourceNames: string[] = [];
    if (imageDataUrls && imageDataUrls.length > 0) {
      for (let i = 0; i < Math.min(imageDataUrls.length, 20); i++) {
        try {
          const rn = await uploadImageAsset(accessToken, customerId, imageDataUrls[i], `${campaignName}_banner_${i + 1}`);
          imageResourceNames.push(rn);
        } catch {
          // Skip failed uploads
        }
      }
    }

    // 2. Create budget (micros = VND * 1000 since VND has no subunit but API uses micros)
    const budgetMicros = budgetPerDayVnd * 1_000_000;
    const budgetTempId = "-1";

    // 3. Create campaign temp id
    const campaignTempId = "-2";

    // 4. Build mutate operations
    const operations: object[] = [
      // Budget
      {
        campaignBudgetOperation: {
          create: {
            resourceName: `customers/${customerId}/campaignBudgets/${budgetTempId}`,
            name: `${campaignName} Budget`,
            amountMicros: budgetMicros,
            deliveryMethod: "STANDARD",
          },
        },
      },
      // Campaign (App Campaign = MULTI_CHANNEL)
      {
        campaignOperation: {
          create: {
            resourceName: `customers/${customerId}/campaigns/${campaignTempId}`,
            name: campaignName,
            status: "PAUSED", // Start paused — user enables manually
            advertisingChannelType: "MULTI_CHANNEL",
            advertisingChannelSubType: "APP_CAMPAIGN",
            appCampaignSetting: {
              appId,
              appStore,
              biddingStrategyGoalType: "OPTIMIZE_INSTALLS_TARGET_INSTALL_COST",
            },
            campaignBudget: `customers/${customerId}/campaignBudgets/${budgetTempId}`,
            startDate: startDate || new Date().toISOString().slice(0, 10).replace(/-/g, ""),
            targetGoogleSearch: true,
            targetSearchNetwork: true,
            targetContentNetwork: true,
            targetPartnerSearchNetwork: false,
          },
        },
      },
      // Ad Group
      {
        adGroupOperation: {
          create: {
            resourceName: `customers/${customerId}/adGroups/-3`,
            campaign: `customers/${customerId}/campaigns/${campaignTempId}`,
            name: `${campaignName} Ad Group`,
            status: "ENABLED",
          },
        },
      },
      // App Ad
      {
        adGroupAdOperation: {
          create: {
            adGroup: `customers/${customerId}/adGroups/-3`,
            status: "ENABLED",
            ad: {
              appAd: {
                headlines: (headlines || []).slice(0, 5).map((h: string) => ({ text: h.slice(0, 30) })),
                descriptions: (descriptions || []).slice(0, 5).map((d: string) => ({ text: d.slice(0, 90) })),
                images: imageResourceNames.map(rn => ({ asset: rn })),
              },
            },
          },
        },
      },
    ];

    const result = await mutate(accessToken, customerId, operations);

    // Extract created campaign resource name
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const campaignResource = (result as any).mutateOperationResponses
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ?.find((r: any) => r.campaignResult)
      ?.campaignResult?.resourceName;

    return NextResponse.json({
      success: true,
      campaignResourceName: campaignResource,
      imageCount: imageResourceNames.length,
      message: `Campaign "${campaignName}" created in PAUSED state. Enable it in Google Ads when ready.`,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
