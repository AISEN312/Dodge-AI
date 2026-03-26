const state = {
  graph: { nodes: [], edges: [] },
  simulation: [],
  selectedNodeId: null,
  highlightNodeIds: new Set(),
  sampleQuestions: []
};

const canvas = document.getElementById("graph-canvas");
const ctx = canvas.getContext("2d");
const metricsEl = document.getElementById("metrics");
const detailsEl = document.getElementById("node-details");
const messagesEl = document.getElementById("messages");
const graphCaptionEl = document.getElementById("graph-caption");
const searchResultsEl = document.getElementById("search-results");

function typeColor(type) {
  const colors = {
    SalesOrder: "#0f766e",
    SalesOrderItem: "#14b8a6",
    Delivery: "#f97316",
    DeliveryItem: "#fb923c",
    BillingDocument: "#7c3aed",
    BillingItem: "#a78bfa",
    JournalEntry: "#1d4ed8",
    Payment: "#111827",
    Customer: "#b91c1c",
    Product: "#0369a1",
    Plant: "#4d7c0f"
  };
  return colors[type] || "#525252";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function renderMetrics(overview) {
  const counts = overview.countsByType || {};
  metricsEl.innerHTML = `
    <div class="metric"><strong>${overview.nodeCount}</strong><span>Nodes</span></div>
    <div class="metric"><strong>${overview.edgeCount}</strong><span>Edges</span></div>
    <div class="metric"><strong>${Object.keys(counts).length}</strong><span>Entity types</span></div>
  `;
}

function addMessage(role, text, payload) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;
  wrapper.innerHTML = `<span class="meta">${role === "user" ? "You" : "Graph Agent"}</span><div>${text}</div>`;
  if (payload) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(payload, null, 2);
    wrapper.appendChild(pre);
  }
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderDetails(node) {
  if (!node) {
    detailsEl.className = "details empty";
    detailsEl.textContent = "Select a node to inspect its metadata.";
    return;
  }

  detailsEl.className = "details";
  const entries = Object.entries(node.metadata || {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== ""
  );
  detailsEl.innerHTML = `
    <h3>${node.label}</h3>
    <p><strong>${node.type}</strong> - ${node.entityId}</p>
    <dl>
      ${entries
        .slice(0, 18)
        .map(
          ([key, value]) =>
            `<dt>${key}</dt><dd>${typeof value === "object" ? JSON.stringify(value) : value}</dd>`
        )
        .join("")}
    </dl>
  `;
}

function buildSimulation(nodes) {
  return nodes.map((node, index) => ({
    ...node,
    x: 120 + (index % 10) * 75 + Math.random() * 40,
    y: 100 + Math.floor(index / 10) * 55 + Math.random() * 30,
    vx: 0,
    vy: 0
  }));
}

function runLayout(iterations = 220) {
  const nodes = state.simulation;
  const edges = state.graph.edges;
  if (!nodes.length) {
    return;
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const width = canvas.width;
  const height = canvas.height;

  for (let i = 0; i < iterations; i += 1) {
    for (const node of nodes) {
      node.vx *= 0.88;
      node.vy *= 0.88;
      const cx = width / 2;
      const cy = height / 2;
      node.vx += (cx - node.x) * 0.0005;
      node.vy += (cy - node.y) * 0.0005;
    }

    for (let a = 0; a < nodes.length; a += 1) {
      for (let b = a + 1; b < nodes.length; b += 1) {
        const left = nodes[a];
        const right = nodes[b];
        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const dist2 = dx * dx + dy * dy + 0.01;
        const force = 2200 / dist2;
        const invDist = 1 / Math.sqrt(dist2);
        const fx = dx * invDist * force;
        const fy = dy * invDist * force;
        left.vx -= fx;
        left.vy -= fy;
        right.vx += fx;
        right.vy += fy;
      }
    }

    for (const edge of edges) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) {
        continue;
      }
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const desired = 72;
      const strength = (dist - desired) * 0.0018;
      const fx = dx * strength;
      const fy = dy * strength;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    for (const node of nodes) {
      node.x = Math.max(28, Math.min(width - 28, node.x + node.vx));
      node.y = Math.max(28, Math.min(height - 28, node.y + node.vy));
    }
  }
}

function drawGraph() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const nodes = state.simulation;
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const edge of state.graph.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) {
      continue;
    }
    const highlighted =
      state.highlightNodeIds.has(source.id) && state.highlightNodeIds.has(target.id);
    ctx.strokeStyle = highlighted ? "rgba(217, 119, 6, 0.75)" : "rgba(15, 118, 110, 0.18)";
    ctx.lineWidth = highlighted ? 2.2 : 1;
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
  }

  for (const node of nodes) {
    const selected = node.id === state.selectedNodeId;
    const highlighted = state.highlightNodeIds.has(node.id);
    ctx.beginPath();
    ctx.fillStyle = highlighted ? "#d97706" : typeColor(node.type);
    ctx.arc(node.x, node.y, selected ? 9 : highlighted ? 7.5 : 6, 0, Math.PI * 2);
    ctx.fill();

    if (selected || highlighted) {
      ctx.fillStyle = "#1d1a17";
      ctx.font = "12px Segoe UI";
      ctx.fillText(node.label.slice(0, 28), node.x + 10, node.y - 10);
    }
  }
}

async function loadGraph(rootId) {
  const query = rootId ? `?rootId=${encodeURIComponent(rootId)}&depth=2` : "";
  const graph = await fetchJson(`/api/graph${query}`);
  state.graph = graph;
  state.simulation = buildSimulation(graph.nodes);
  runLayout();
  drawGraph();
  graphCaptionEl.textContent = `${graph.nodes.length} nodes in the current neighborhood`;
}

async function loadNode(id, shouldRefocus = true) {
  const payload = await fetchJson(`/api/node?id=${encodeURIComponent(id)}&depth=1`);
  state.selectedNodeId = id;
  renderDetails(payload.node);
  if (shouldRefocus) {
    await loadGraph(id);
  } else {
    drawGraph();
  }
}

canvas.addEventListener("click", async (event) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  const hit = state.simulation.find((node) => Math.hypot(node.x - x, node.y - y) <= 10);
  if (hit) {
    await loadNode(hit.id);
  }
});

async function sendQuestion(question) {
  addMessage("user", question);
  const response = await fetchJson("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question })
  });
  state.highlightNodeIds = new Set(response.highlightNodeIds || []);
  addMessage("assistant", response.answer, response.data);
  if (response.highlightNodeIds && response.highlightNodeIds.length) {
    await loadGraph(response.highlightNodeIds[0]);
  } else {
    drawGraph();
  }
}

document.getElementById("send-button").addEventListener("click", async () => {
  const input = document.getElementById("chat-input");
  const question = input.value.trim();
  if (!question) {
    return;
  }
  input.value = "";
  try {
    await sendQuestion(question);
  } catch (error) {
    addMessage("assistant", `Something went wrong: ${error.message}`);
  }
});

document.getElementById("sample-button").addEventListener("click", () => {
  const input = document.getElementById("chat-input");
  input.value =
    state.sampleQuestions[Math.floor(Math.random() * state.sampleQuestions.length)] ||
    "Trace the full flow of billing document 90504248";
});

document.getElementById("reset-button").addEventListener("click", async () => {
  state.highlightNodeIds = new Set();
  state.selectedNodeId = null;
  renderDetails(null);
  await loadGraph();
});

document.getElementById("search-button").addEventListener("click", async () => {
  const value = document.getElementById("search-input").value.trim();
  if (!value) {
    searchResultsEl.classList.add("hidden");
    searchResultsEl.innerHTML = "";
    return;
  }
  const payload = await fetchJson(`/api/search?q=${encodeURIComponent(value)}`);
  searchResultsEl.classList.remove("hidden");
  searchResultsEl.innerHTML = payload.results
    .map(
      (node) =>
        `<button class="search-result" data-node-id="${node.id}"><strong>${node.label}</strong><span>${node.type} - ${node.entityId}</span></button>`
    )
    .join("");
});

searchResultsEl.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-node-id]");
  if (!target) {
    return;
  }
  const id = target.getAttribute("data-node-id");
  state.highlightNodeIds = new Set([id]);
  searchResultsEl.classList.add("hidden");
  searchResultsEl.innerHTML = "";
  await loadNode(id);
});

window.addEventListener("resize", () => drawGraph());

(async function init() {
  const overview = await fetchJson("/api/overview");
  state.sampleQuestions = overview.sampleQuestions;
  renderMetrics(overview.overview);
  addMessage(
    "assistant",
    "Ask about products, billing flows, incomplete order chains, or specific document numbers."
  );
  await loadGraph();
})();
