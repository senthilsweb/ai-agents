import { eveChannel } from "eve/channels/eve";
import { httpBasic, localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [
    localDev(),
    vercelOidc(),
    ...(process.env.ROUTE_AUTH_BASIC_PASSWORD
      ? [
          httpBasic({
            username: process.env.ROUTE_AUTH_BASIC_USER ?? "operator",
            password: process.env.ROUTE_AUTH_BASIC_PASSWORD,
          }),
        ]
      : []),
    placeholderAuth(),
  ],
});
