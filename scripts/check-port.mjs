// Stops `npm run dev` when an app's fixed port is already taken.
//
// Nuxt's dev server never fails on a busy port: it falls back to 3000 or a
// random port. lokl can't run anywhere else, because Supabase sign-in
// redirects and Stripe return URLs are registered for 3100 and 3101.
//
// Usage: node ../../scripts/check-port.mjs <port> <app name>
import net from "node:net";

const port = Number(process.argv[2]);
const app = process.argv[3] ?? "this app";
if (!Number.isInteger(port) || port <= 0) {
  console.error(`check-port: expected a port number, got "${process.argv[2] ?? ""}"`);
  process.exit(2);
}

// Something accepting connections on this address and port?
const answers = (host) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });

// Can we bind it ourselves? Catches listeners on addresses we didn't probe.
const bindable = () =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });

const [v4, v6, free] = await Promise.all([answers("127.0.0.1"), answers("::1"), bindable()]);

if (v4 || v6 || !free) {
  console.error(`
  Port ${port} is already in use, so ${app} won't start.

  lokl only runs on its fixed ports (website 3100, admin 3101), because sign-in
  links and Stripe return URLs point there. Find what's using the port with:

    lsof -iTCP:${port} -sTCP:LISTEN

  Stop it, then run the dev server again.
`);
  process.exit(1);
}
