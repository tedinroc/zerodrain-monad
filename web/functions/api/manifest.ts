import { buildManifestPayload, jsonResponse, type PagesContext } from "../_lib/server";

export async function onRequestGet(context: PagesContext) {
  const url = new URL(context.request.url);
  const hijacked = url.searchParams.get("hijacked") === "1";
  return jsonResponse(await buildManifestPayload(hijacked));
}
