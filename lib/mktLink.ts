/**
 * "Mở MKT System" link: the Creative page of MKT System already filtered by
 * the tag just pushed.
 *
 * The template is MKT_SYSTEM_URL when set (Vercel env), otherwise the
 * production web app's own Creative URL. Placeholders, filled in the browser
 * at click time so the date range is in the viewer's own time zone:
 *   {tag}  the tag to filter by
 *   {from} / {to}  createdFrom range, the same default the page itself uses:
 *          00:00 thirty days ago to 23:59:59.999 today
 */
export const MKT_CREATIVE_URL =
  "https://mktpro.aperogroup.ai/automate-campaign/creative" +
  "?createdFromEnd={to}&createdFromStart={from}&format&owner&page=1&pageSize=50&sort=createdAt_desc&tags={tag}";

export function mktLinkTemplate(): string {
  return process.env.MKT_SYSTEM_URL || MKT_CREATIVE_URL;
}

/** Browser side: fills {tag}, {from}, {to}. Keep in step with mktFill() in public/outro-studio/index.html. */
export function fillMktLink(template: string, tag: string, now = new Date()): string {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return template
    .split("{tag}").join(encodeURIComponent(tag || ""))
    .split("{from}").join(encodeURIComponent(from.toISOString()))
    .split("{to}").join(encodeURIComponent(to.toISOString()));
}
