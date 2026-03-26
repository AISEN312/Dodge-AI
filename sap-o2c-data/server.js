const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { loadDataset, getNeighborhood, searchNodes } = require("./src/data");
const { executePlan, heuristicPlan, isInDomain } = require("./src/queryEngine");
const { geminiPlan } = require("./src/llm");

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 3000);

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, contentType) {
  return fs
    .readFile(filePath)
    .then((contents) => {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(contents);
    })
    .catch(() => {
      res.writeHead(404);
      res.end("Not found");
    });
}

function routeStatic(res, pathname) {
  const fileMap = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
    "/app.js": ["app.js", "application/javascript; charset=utf-8"]
  };
  const file = fileMap[pathname];
  if (!file) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  return sendFile(res, path.join(publicDir, file[0]), file[1]);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function start() {
  console.log("Loading dataset and building graph...");
  const graph = await loadDataset(rootDir);
  console.log(
    `Loaded ${graph.overview.nodeCount} nodes and ${graph.overview.edgeCount} edges across the O2C graph.`
  );

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/api/overview") {
      return json(res, 200, {
        overview: graph.overview,
        sampleQuestions: [
          "Which products are associated with the highest number of billing documents?",
          "Trace the full flow of billing document 90504248",
          "Identify sales orders with broken or incomplete flows",
          "90504248 - find the journal entry linked to this"
        ]
      });
    }

    if (req.method === "GET" && pathname === "/api/search") {
      const query = url.searchParams.get("q") || "";
      return json(res, 200, { results: searchNodes(graph, query, 12) });
    }

    if (req.method === "GET" && pathname === "/api/node") {
      const id = url.searchParams.get("id") || "";
      const depth = Number(url.searchParams.get("depth") || 1);
      if (!graph.nodes.has(id)) {
        return json(res, 404, { error: "Node not found" });
      }
      return json(res, 200, {
        node: graph.nodes.get(id),
        neighborhood: getNeighborhood(graph, id, depth)
      });
    }

    if (req.method === "GET" && pathname === "/api/graph") {
      const rootId =
        url.searchParams.get("rootId") ||
        Array.from(graph.nodes.keys()).find((id) => id.startsWith("SalesOrder:"));
      const depth = Number(url.searchParams.get("depth") || 2);
      return json(res, 200, getNeighborhood(graph, rootId, depth));
    }

    if (req.method === "POST" && pathname === "/api/chat") {
      try {
        const body = await readBody(req);
        const question = String(body.question || "").trim();
        if (!question) {
          return json(res, 400, { error: "Question is required" });
        }

        if (!isInDomain(question)) {
          return json(res, 200, {
            answer:
              "This system is designed to answer questions related to the provided dataset only.",
            data: null,
            plan: { intent: "unsupported" },
            highlightNodeIds: []
          });
        }

        let plan = null;
        try {
          plan = await geminiPlan(question);
        } catch (error) {
          console.warn(error.message);
        }
        if (!plan || !plan.intent) {
          plan = heuristicPlan(question);
        }

        const result = await executePlan(graph, plan);
        return json(res, 200, { ...result, plan });
      } catch (error) {
        console.error(error);
        return json(res, 500, { error: "Failed to process chat request" });
      }
    }

    return routeStatic(res, pathname);
  });

  server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
