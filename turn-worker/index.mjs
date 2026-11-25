export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const headers = { "Cache-Control": "no-store", Vary: "Origin" };
    const error = (message, status) => Response.json({ error: message }, { status, headers });
    if (!origin || origin !== env.LIFE_ORIGIN) return error("Origin not allowed", 403);
    headers["Access-Control-Allow-Origin"] = origin;
    if (request.method !== "GET") return error("Method not allowed", 405);
    if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) return error("Relay service is not configured", 503);

    try {
      const keyId = encodeURIComponent(env.TURN_KEY_ID);
      const upstream = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.TURN_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ttl: 14400 }),
          signal: AbortSignal.timeout(6000),
        }
      );
      if (!upstream.ok) return error("Relay provider unavailable", 502);
      const { iceServers } = await upstream.json();
      if (!Array.isArray(iceServers) || !iceServers.length) {
        return error("Relay provider returned no servers", 502);
      }
      return Response.json({ iceServers }, { headers });
    } catch {
      return error("Relay provider unavailable", 502);
    }
  },
};
