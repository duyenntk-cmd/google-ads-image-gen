/**
 * Who may use what. The role is the "Role" column (E) of the Users sheet.
 *
 *   ua (or empty)  every tool, as before roles existed
 *   creative       creative tools only: no Launch Camp (creates real campaigns
 *                  on Google Ads) and no Phân tích Camp (reads revenue / ROAS)
 *
 * Pure module, imported by both the server (API checks) and the page (hides
 * what a role cannot open). Change a person's access in the sheet; it takes
 * effect within 5 minutes, no deploy.
 */
export type Role = "ua" | "creative";
export type Capability = "launch_camp" | "camp_report";

const ROLE_CAPS: Record<Role, Capability[]> = {
  ua: ["launch_camp", "camp_report"],
  creative: [],
};

export const CAPABILITY_LABEL: Record<Capability, string> = {
  launch_camp: "Launch Camp",
  camp_report: "Phân tích Camp",
};

/** Unknown or empty values fall back to "ua" so a typo never locks someone out of their work. */
export function parseRole(v: unknown): Role {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "creative" ? "creative" : "ua";
}

export function can(role: Role | string | undefined | null, cap: Capability): boolean {
  return ROLE_CAPS[parseRole(role)].includes(cap);
}
