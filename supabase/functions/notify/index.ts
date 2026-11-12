// KOMP – sender push-varsel til familien når noen deler et bilde eller en video.
// Kalles av databasen (trigger on_post_created) med { post_id }.
// Funksjonen stoler ikke på det som sendes inn: den sender bare for ekte innlegg som er
// under 10 minutter gamle og ikke allerede varslet, så den kan ligge åpen uten nøkkel.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  let postId: string | undefined;
  try { postId = (await req.json()).post_id; } catch { /* tom body */ }
  if (!postId) return Response.json({ error: "post_id mangler" }, { status: 400 });

  // Marker innlegget som varslet, atomisk, så samme innlegg aldri varsles to ganger.
  const { data: post } = await sb.from("posts")
    .update({ notified: true })
    .eq("id", postId).eq("notified", false)
    .gt("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
    .select("id, author, media_type, caption")
    .maybeSingle();
  if (!post) return Response.json({ sent: 0, reason: "ingenting å varsle" });

  const [{ data: keys, error: keyErr }, { data: author }, { data: subs }] = await Promise.all([
    sb.from("app_secrets").select("vapid_public, vapid_private, vapid_subject").eq("id", 1).single(),
    sb.from("profiles").select("display_name").eq("id", post.author).single(),
    sb.from("push_subscriptions")
      .select("endpoint, p256dh, auth, profiles!inner(blocked)")
      .neq("user_id", post.author)
      .eq("profiles.blocked", false),
  ]);
  if (keyErr || !keys) return Response.json({ error: "nøkler mangler i app_secrets" }, { status: 500 });

  webpush.setVapidDetails(keys.vapid_subject, keys.vapid_public, keys.vapid_private);

  const name = author?.display_name ?? "Noen";
  const what = post.media_type === "video" ? "en video" : "et bilde";
  const caption = (post.caption ?? "").trim();
  const payload = JSON.stringify({
    title: `${name} delte ${what}`,
    body: caption ? (caption.length > 120 ? caption.slice(0, 117) + "…" : caption) : "Trykk for å se det i KOMP.",
    tag: `post-${post.id}`,
    url: "./",
  });

  const dead: string[] = [];
  const results = await Promise.allSettled((subs ?? []).map((s) =>
    webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      payload,
      { TTL: 60 * 60 * 24, urgency: "normal" },
    ).catch((err: { statusCode?: number }) => {
      if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.endpoint);
      throw err;
    })
  ));
  if (dead.length) await sb.from("push_subscriptions").delete().in("endpoint", dead);

  const sent = results.filter((r) => r.status === "fulfilled").length;
  return Response.json({ sent, failed: results.length - sent, removed: dead.length });
});
