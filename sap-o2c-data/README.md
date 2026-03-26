# SAP Order-to-Cash Context Graph

A lightweight order-to-cash graph exploration app built directly on top of the provided JSONL dataset.

## What it does

- Converts fragmented SAP-style entities into a connected graph
- Visualizes node neighborhoods for sales orders, deliveries, billing documents, journals, payments, customers, products, and plants
- Supports grounded natural-language queries through a guarded query planner
- Optionally uses Gemini free tier for intent planning when `GEMINI_API_KEY` is provided
- Falls back to deterministic heuristics when no LLM key is available

## Architecture

### Backend

- `server.js`: dependency-free HTTP server and API routes
- `src/data.js`: JSONL ingestion, graph construction, neighborhood search, and node search
- `src/queryEngine.js`: domain guardrails, heuristic planner, and executable query patterns
- `src/llm.js`: optional Gemini planner that returns a constrained JSON query plan

### Frontend

- `public/index.html`: two-pane UI with graph explorer, inspector, and chat
- `public/app.js`: canvas-based graph rendering, chat wiring, search, and highlighting
- `public/styles.css`: responsive styling

## Graph model

### Nodes

- `SalesOrder`
- `SalesOrderItem`
- `Delivery`
- `DeliveryItem`
- `BillingDocument`
- `BillingItem`
- `JournalEntry`
- `Payment`
- `Customer`
- `Product`
- `Plant`

### Key relationships

- `SalesOrder -> SalesOrderItem` via `HAS_ITEM`
- `SalesOrder -> Customer` via `SOLD_TO`
- `SalesOrderItem -> Product` via `FOR_PRODUCT`
- `SalesOrderItem -> Plant` via `PRODUCED_AT`
- `Delivery -> DeliveryItem` via `HAS_ITEM`
- `DeliveryItem -> SalesOrderItem` via `FULFILLS`
- `Delivery -> SalesOrder` via `DELIVERS`
- `BillingDocument -> BillingItem` via `HAS_ITEM`
- `BillingItem -> DeliveryItem` via `BILLS_DELIVERY_ITEM`
- `BillingDocument -> Delivery` via `BILLS_DELIVERY`
- `BillingDocument -> JournalEntry` via `POSTED_TO`
- `Payment -> JournalEntry` via `CLEARS`

## Query strategy

The chat flow is:

1. Guardrail check: reject prompts that are outside the dataset domain
2. Planner step:
   - Gemini free tier planner if `GEMINI_API_KEY` is configured
   - Otherwise a deterministic heuristic planner
3. Execution step: run a supported structured operation against the in-memory graph/indexes
4. Response step: return a natural-language answer, structured evidence, and node IDs to highlight in the graph

Supported query intents:

- Top billed products
- Trace a billing document across the O2C chain
- Find incomplete sales-order flows
- Find journal entry linked to a billing document
- Direct document lookup by ID

## Guardrails

- Off-topic prompts are rejected with a dataset-only response
- LLM planning is constrained to a fixed JSON schema
- Execution is restricted to allowed intents only
- Answers are generated from dataset-backed results, not free-form hallucinated text

## Run locally

1. Ensure Node.js 18+ is installed
2. Copy `.env.example` to `.env` if you want optional Gemini planning
3. Start the app:

```bash
node server.js
```

4. Open `http://localhost:3000`

## Example questions

- Which products are associated with the highest number of billing documents?
- Trace the full flow of billing document 90504248
- Identify sales orders with broken or incomplete flows
- 90504248 - find the journal entry linked to this

## Notes and tradeoffs

- The app uses an in-memory graph to keep setup simple and avoid database dependencies
- The chat system intentionally supports a focused set of high-value analytical intents instead of open-ended SQL generation
- Payments are modeled from clearing-document groupings in the receivables payment data
- The graph view shows local neighborhoods rather than the entire graph at once to stay performant and readable
