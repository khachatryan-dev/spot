# ADR 0001 — Realtime transport

- **Status:** Accepted
- **Date:** 2026-10-07
- **Spec:** §28 Realtime, §53 Deployment

## Context

Staff screens (order board, kitchen, table requests) and the guest's order page
must update within a second or two when something changes. Today they poll
every 10–15 seconds.

The app is deployed on **Vercel** (§53). Vercel functions are request/response:
they cannot hold a long-lived WebSocket server, which §28 suggests
(WebSocket/Socket.IO + Redis Pub/Sub).

Already in place: every order and table-request change publishes a domain event
after commit (`src/server/events/order-events.ts`).

## Design (same for every option)

- **Events are hints, not data** (§28): `{ type, orderId | requestId, status }`
  on a channel such as `location:<id>` (staff) or `session:<id>` (guests).
  Screens react by re-fetching from the server. No prices, items or personal
  data travel over the realtime channel.
- **Authorized subscriptions:** the server signs short-lived tokens that allow
  only the channels the person may see (staff with `order:read` for their
  locations; guests for their own table session).
- **One small interface** so the transport can be swapped:
  `publish(channel, event)` on the server, `useRealtime(channel, onEvent)` in
  the browser. Polling stays as a fallback when the connection drops.

## Options

### A. Managed service (Ably or Pusher)

The Next.js server publishes with an HTTPS call; browsers connect to the
provider with a token the server signs.

- ➕ No servers to run or scale; works on Vercel as-is; reconnection, presence
  and history built in.
- ➕ Free tiers cover the first year comfortably (Ably: ~6M messages/month;
  Pusher: 200k messages/day).
- ➖ Third-party dependency and a future cost once traffic grows.
- ➖ Events pass through the provider (they're only hints, no personal data).

### B. Separate Socket.IO server + Redis Pub/Sub (what §28 describes)

A small Node service (e.g. on Railway, Fly.io or Render, ~$5/month) holds the
WebSockets; Next.js publishes to Redis; the service fans out to rooms.

- ➕ Matches the spec; no vendor lock-in; full control.
- ➕ Redis is needed later anyway (caching, rate limits at scale).
- ➖ A second service to deploy, monitor, secure and scale (sticky sessions or
  the Redis adapter when running more than one instance).
- ➖ More code to own: auth handshake, rooms, reconnection.

### C. Server-Sent Events from Next.js on Vercel

Browsers keep an HTTP stream open to a route handler.

- ➕ No extra service; simple browser API.
- ➖ Serverless function time limits force frequent reconnects; each open
  stream is a running function (cost) and needs its own Redis subscription.
- ➖ Doesn't scale well on Vercel. **Not recommended** here.

## Recommendation

**Option A (Ably)** for Year 1: fastest to ship, nothing extra to operate,
free at our expected volume, and the hint-only design keeps the provider
replaceable. Revisit Option B if costs or control become an issue — the
`publish` / `useRealtime` interface makes that a contained change.

## Decision

**Option A — Ably**, chosen on 2026-10-07.

- `ABLY_API_KEY` is optional. Without it the app keeps polling (10–15 s), so
  local development and tests never depend on Ably.
- Server side: `src/server/realtime/realtime.ts` — `publish(channel, event)`
  and channel helpers; an Ably REST publisher when the key is set, otherwise a
  no-op.
- Channels: `restaurant:<restaurantId>:location:<locationId>` for staff
  screens, `session:<tableSessionId>` for guests at a table.
- Day 47: order and table-request events are published to these channels.
- Day 48: `POST /api/realtime/token` signs subscribe-only tokens for one
  channel (staff: `order:read` at that restaurant and location; guests: current
  members of that visit) with an anonymous client id; `LiveRefresh` re-fetches
  the page ~300 ms after a hint and falls back to polling when disconnected or
  when realtime is off. Verified offline; live verification needs an Ably key.
