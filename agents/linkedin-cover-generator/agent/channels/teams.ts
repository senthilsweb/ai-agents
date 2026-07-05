// Microsoft Teams channel — runs the agent as a Teams bot via the Bot
// Framework Activity protocol. Mounts POST /eve/v1/teams; each inbound
// activity's Bot Connector JWT is verified, so the route is safe to expose
// publicly. Requires MICROSOFT_APP_ID / MICROSOFT_APP_PASSWORD (and
// MICROSOFT_TENANT_ID for single-tenant bots) — see docs/consume-from-teams.md.
//
// Dispatch: personal chats always; channel/group messages only when the bot
// is @mentioned; PLUS `unknown` scope, which is what Azure's "Test in Web
// Chat" sends (its activities carry no conversationType, so eve cannot
// classify them as personal) — without it, Web Chat messages are silently
// dropped with a 200 and the bot appears dead during testing.
import { defaultTeamsAuth, teamsChannel } from "eve/channels/teams";

export default teamsChannel({
  onMessage(_ctx, message) {
    const dispatch =
      message.scope === "personal" ||
      message.scope === "unknown" || // Azure "Test in Web Chat"
      message.isBotMentioned;
    if (!dispatch) return null;
    return { auth: defaultTeamsAuth(message) };
  },
});
