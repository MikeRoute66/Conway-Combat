# Multiplayer Life

Open the game in a current browser over HTTPS or on localhost. Click **Create room**, then send friends the room code or use **Copy invite link**. Friends can open the invite or enter the code in any copy of the same game version, then click **Join room**. Each room holds up to four players. Keep the host tab open for the duration of the match. Closing it ends the room.

Publish the static files to GitHub Pages, or put index.html, styles.css, match.js, script.js, rooms.js, and room-config.js at the root of an itch.io HTML5 ZIP. For local development, run `npm start` and open http://localhost:8787. Node only serves the preview files. It is optional, and any static server works.

The host browser runs the simulation. PeerJS Cloud handles room discovery and connection setup. The game uses WebRTC with STUN for direct connections across networks. Some firewalls and NAT configurations require a TURN relay.

To enable relay fallback, set `lifeIceServerEndpoint` in `room-config.js` to an HTTPS endpoint returning `{ "iceServers": [...] }` in the standard browser format. Include both a STUN server and a TURN server with short-lived credentials, and allow requests from the origin serving the game. TURN over TLS on port 443 can help on networks that block UDP. Keep permanent relay secrets on the credential service.

### Cloudflare TURN

The Worker in turn-worker/ exchanges a server-side Cloudflare Realtime TURN key for temporary credentials. Deploy it from the turn-worker directory. Set LIFE_ORIGIN to the game origin (for example, https://your-name.github.io, without the repository path or trailing slash). Store TURN_KEY_ID and TURN_API_TOKEN as Worker secrets. Set lifeIceServerEndpoint to the deployed Worker URL and republish the game. Only the publisher needs a Cloudflare account. The game stays on Pages and players use the same room flow.

The endpoint issues temporary credentials to visitors of the public game. Origin checks control browser access and do not authenticate callers. Monitor TURN usage and apply provider-side rate limits if needed.
