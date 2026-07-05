// Microsoft Teams channel — runs the agent as a Teams bot via the Bot
// Framework Activity protocol. Mounts POST /eve/v1/teams; each inbound
// activity's Bot Connector JWT is verified, so the route is safe to expose
// publicly. Requires MICROSOFT_APP_ID / MICROSOFT_APP_PASSWORD (and
// MICROSOFT_TENANT_ID for single-tenant bots) — see docs/consume-from-teams.md.
//
// Defaults: personal chats always dispatch; channel/group messages only when
// the bot is @mentioned. Human-in-the-loop prompts render as Adaptive Cards.
import { teamsChannel } from "eve/channels/teams";

export default teamsChannel();
