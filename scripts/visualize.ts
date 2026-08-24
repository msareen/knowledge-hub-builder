// khb visualize — scan bundles + refs + concept links, serve an interactive graph from a
// local server. Two zoom levels: bundles (outer graph, refs.md edges) and, click a bundle,
// its concepts (inner graph, markdown-link edges) with a panel to view a concept's body.
// Unpinned, it picks a random free port (and retries on another if that one's taken)
// rather than fighting over one fixed number; it also exits on its own once the browser
// tab goes away, since a background `khb visualize` nobody's looking at is just a stray
// process. `--port N` pins a specific port.
import { buildGraphData, readConceptFile } from "./lib/graph";
import { renderGraphPage } from "./lib/graph-page";
import { takeFlag, takeOpt, rejectUnknownFlags } from "./lib/args";

const USAGE = "khb visualize [--port N] [--no-open]";
const argv = process.argv.slice(2);
// port 0 asks the OS for any free port — no fixed default to collide with something else
// already running on the machine. `--port N` and `--port=N` both pin it.
const portArg = takeOpt(argv, "--port");
const noOpen = takeFlag(argv, "--no-open");
rejectUnknownFlags(argv, USAGE);

// A port that is not a port used to become NaN and silently serve on a random one, which
// looks like the flag working right up until nothing is listening where you expected.
const requestedPort = portArg === undefined ? 0 : Number(portArg);
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
  console.error(`--port must be a number between 0 and 65535, not: ${portArg}`);
  console.error(`Usage: ${USAGE}`);
  process.exit(1);
}

function summarize(data: ReturnType<typeof buildGraphData>) {
  const concepts = Object.values(data.bundleGraphs).reduce((n, g) => n + g.concepts.length, 0);
  const links = Object.values(data.bundleGraphs).reduce((n, g) => n + g.edges.length, 0);
  return `${data.bundles.length} bundles, ${data.bundleEdges.length} refs, ${concepts} concepts, ${links} concept links`;
}

let data = buildGraphData();

// The page pings /api/heartbeat every few seconds and beacons /api/close on unload.
// Nothing marks the server "connected" until the first heartbeat, so a slow first
// page-load never races the idle timeout below.
let connected = false;
let lastHeartbeat = Date.now();
const IDLE_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 3_000;

const fetchHandler = (req: Request) => {
  const url = new URL(req.url);
  if (url.pathname === "/")
    return new Response(renderGraphPage(data), { headers: { "content-type": "text/html; charset=utf-8" } });
  if (url.pathname === "/api/graph") {
    if (url.searchParams.get("rebuild")) data = buildGraphData();
    return Response.json(data);
  }
  if (url.pathname === "/api/file") {
    const bundle = url.searchParams.get("bundle") ?? "";
    const path = url.searchParams.get("path") ?? "";
    const body = readConceptFile(bundle, path);
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (url.pathname === "/api/heartbeat") {
    connected = true;
    lastHeartbeat = Date.now();
    return new Response("ok");
  }
  if (url.pathname === "/api/close" && req.method === "POST") {
    console.log("khb visualize — browser closed, shutting down.");
    setTimeout(() => process.exit(0), 50); // let the response flush first
    return new Response("ok");
  }
  return new Response("not found", { status: 404 });
};

let server;
try {
  server = Bun.serve({ port: requestedPort, fetch: fetchHandler });
} catch (e) {
  if (requestedPort && (e as { code?: string }).code === "EADDRINUSE") {
    console.warn(`Port ${requestedPort} is busy — picking a free one instead.`);
    server = Bun.serve({ port: 0, fetch: fetchHandler });
  } else throw e;
}

setInterval(() => {
  if (connected && Date.now() - lastHeartbeat > IDLE_TIMEOUT_MS) {
    console.log("khb visualize — browser tab gone, shutting down.");
    process.exit(0);
  }
}, HEARTBEAT_INTERVAL_MS).unref();

const url = `http://localhost:${server.port}`;
console.log(`khb visualize → ${url}  (${summarize(data)})`);

// Open the default browser. If that fails the URL is already printed above, so a headless
// or locked-down box just falls back to copy-paste rather than erroring out.
if (!noOpen) {
  const cmd =
    process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : process.platform === "darwin"
        ? ["open", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).unref();
  } catch {
    console.warn("Could not launch a browser — open the URL above yourself.");
  }
}
console.log(`The server exits on its own once you close the tab. Ctrl+C also works.`);
