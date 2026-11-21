import { fetchAndHashServedBundle, jsonResponse, type PagesContext } from "../_lib/server";

export async function onRequestGet(context: PagesContext) {
  try {
    const url = new URL(context.request.url);
    const hijacked = url.searchParams.get("hijacked") === "1";
    return jsonResponse(await fetchAndHashServedBundle(context, hijacked));
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "Manifest check failed" },
      500
    );
  }
}
