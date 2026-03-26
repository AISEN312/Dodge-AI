const fs = require("fs/promises");
const path = require("path");

function clean(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function normalizeItem(value) {
  const trimmed = clean(value);
  if (!trimmed) {
    return "";
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return String(numeric);
  }
  return trimmed.replace(/^0+/, "") || "0";
}

function nodeId(type, id) {
  return `${type}:${clean(id)}`;
}

function money(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readJsonlDir(rootDir, folder) {
  const dirPath = path.join(rootDir, folder);
  const files = (await fs.readdir(dirPath))
    .filter((file) => file.endsWith(".jsonl"))
    .sort();

  const rows = [];
  for (const file of files) {
    const contents = await fs.readFile(path.join(dirPath, file), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) {
        rows.push(JSON.parse(trimmed));
      }
    }
  }
  return rows;
}

async function loadDataset(rootDir) {
  const [
    salesOrderHeaders,
    salesOrderItems,
    deliveryHeaders,
    deliveryItems,
    billingHeaders,
    billingItems,
    journals,
    payments,
    customers,
    customerAddresses,
    products,
    productDescriptions,
    plants
  ] = await Promise.all([
    readJsonlDir(rootDir, "sales_order_headers"),
    readJsonlDir(rootDir, "sales_order_items"),
    readJsonlDir(rootDir, "outbound_delivery_headers"),
    readJsonlDir(rootDir, "outbound_delivery_items"),
    readJsonlDir(rootDir, "billing_document_headers"),
    readJsonlDir(rootDir, "billing_document_items"),
    readJsonlDir(rootDir, "journal_entry_items_accounts_receivable"),
    readJsonlDir(rootDir, "payments_accounts_receivable"),
    readJsonlDir(rootDir, "business_partners"),
    readJsonlDir(rootDir, "business_partner_addresses"),
    readJsonlDir(rootDir, "products"),
    readJsonlDir(rootDir, "product_descriptions"),
    readJsonlDir(rootDir, "plants")
  ]);

  const nodes = new Map();
  const edges = [];
  const adjacency = new Map();

  const salesOrders = new Map();
  const salesOrderItemMap = new Map();
  const deliveryMap = new Map();
  const deliveryItemMap = new Map();
  const billingMap = new Map();
  const billingItemMap = new Map();
  const journalMap = new Map();
  const paymentMap = new Map();
  const customerMap = new Map();
  const productMap = new Map();
  const plantMap = new Map();
  const addressesById = new Map();
  const descriptionsByProduct = new Map();

  for (const address of customerAddresses) {
    addressesById.set(clean(address.addressId), address);
  }

  for (const description of productDescriptions) {
    const product = clean(description.product);
    if (!descriptionsByProduct.has(product) || clean(description.language) === "EN") {
      descriptionsByProduct.set(product, description);
    }
  }

  function addNode(type, id, label, metadata = {}) {
    const canonicalId = nodeId(type, id);
    const existing = nodes.get(canonicalId);
    const node = existing || {
      id: canonicalId,
      type,
      entityId: clean(id),
      label,
      metadata: {}
    };
    node.label = label || node.label;
    node.metadata = { ...node.metadata, ...metadata };
    nodes.set(canonicalId, node);
    return node;
  }

  function addEdge(source, target, relationship, metadata = {}) {
    if (!nodes.has(source) || !nodes.has(target)) {
      return;
    }
    const id = `${source}->${relationship}->${target}`;
    edges.push({ id, source, target, relationship, metadata });
    if (!adjacency.has(source)) {
      adjacency.set(source, new Set());
    }
    if (!adjacency.has(target)) {
      adjacency.set(target, new Set());
    }
    adjacency.get(source).add(target);
    adjacency.get(target).add(source);
  }

  for (const record of customers) {
    const id = clean(record.customer || record.businessPartner);
    customerMap.set(id, record);
    const address = addressesById.get(clean(record.addressId));
    addNode("Customer", id, record.businessPartnerName || record.businessPartnerFullName || id, {
      ...record,
      address
    });
  }

  for (const record of plants) {
    plantMap.set(clean(record.plant), record);
    addNode("Plant", record.plant, record.plantName || record.plant, record);
  }

  for (const record of products) {
    const product = clean(record.product);
    productMap.set(product, record);
    const description = descriptionsByProduct.get(product);
    addNode("Product", product, description?.productDescription || record.productOldId || product, {
      ...record,
      description: description?.productDescription || ""
    });
  }

  for (const record of salesOrderHeaders) {
    const orderId = clean(record.salesOrder);
    salesOrders.set(orderId, record);
    addNode("SalesOrder", orderId, `SO ${orderId}`, record);
  }

  for (const record of salesOrderItems) {
    const orderId = clean(record.salesOrder);
    const itemId = normalizeItem(record.salesOrderItem);
    const compositeId = `${orderId}-${itemId}`;
    const product = clean(record.material);
    const plant = clean(record.productionPlant);
    salesOrderItemMap.set(compositeId, record);
    addNode("SalesOrderItem", compositeId, `SO ${orderId}/${itemId}`, record);
    addEdge(nodeId("SalesOrder", orderId), nodeId("SalesOrderItem", compositeId), "HAS_ITEM");
    if (customerMap.has(clean(salesOrders.get(orderId)?.soldToParty))) {
      addEdge(
        nodeId("SalesOrder", orderId),
        nodeId("Customer", clean(salesOrders.get(orderId).soldToParty)),
        "SOLD_TO"
      );
    }
    if (productMap.has(product)) {
      addEdge(nodeId("SalesOrderItem", compositeId), nodeId("Product", product), "FOR_PRODUCT");
    }
    if (plantMap.has(plant)) {
      addEdge(nodeId("SalesOrderItem", compositeId), nodeId("Plant", plant), "PRODUCED_AT");
    }
  }

  for (const record of deliveryHeaders) {
    const deliveryId = clean(record.deliveryDocument);
    deliveryMap.set(deliveryId, record);
    addNode("Delivery", deliveryId, `Delivery ${deliveryId}`, record);
  }

  for (const record of deliveryItems) {
    const deliveryId = clean(record.deliveryDocument);
    const itemId = normalizeItem(record.deliveryDocumentItem);
    const compositeId = `${deliveryId}-${itemId}`;
    const referenceOrder = clean(record.referenceSdDocument);
    const referenceItem = normalizeItem(record.referenceSdDocumentItem);
    const plant = clean(record.plant);
    deliveryItemMap.set(compositeId, record);
    addNode("DeliveryItem", compositeId, `Delivery ${deliveryId}/${itemId}`, record);
    addEdge(nodeId("Delivery", deliveryId), nodeId("DeliveryItem", compositeId), "HAS_ITEM");
    if (salesOrderItemMap.has(`${referenceOrder}-${referenceItem}`)) {
      addEdge(
        nodeId("DeliveryItem", compositeId),
        nodeId("SalesOrderItem", `${referenceOrder}-${referenceItem}`),
        "FULFILLS"
      );
      addEdge(nodeId("Delivery", deliveryId), nodeId("SalesOrder", referenceOrder), "DELIVERS");
    }
    if (plantMap.has(plant)) {
      addEdge(nodeId("DeliveryItem", compositeId), nodeId("Plant", plant), "SHIPS_FROM");
    }
  }

  for (const record of billingHeaders) {
    const billingId = clean(record.billingDocument);
    billingMap.set(billingId, record);
    addNode("BillingDocument", billingId, `Billing ${billingId}`, record);
    const customer = clean(record.soldToParty);
    if (customerMap.has(customer)) {
      addEdge(nodeId("BillingDocument", billingId), nodeId("Customer", customer), "BILLED_TO");
    }
  }

  for (const record of billingItems) {
    const billingId = clean(record.billingDocument);
    const itemId = normalizeItem(record.billingDocumentItem);
    const compositeId = `${billingId}-${itemId}`;
    const referenceDelivery = clean(record.referenceSdDocument);
    const referenceItem = normalizeItem(record.referenceSdDocumentItem);
    const product = clean(record.material);
    billingItemMap.set(compositeId, record);
    addNode("BillingItem", compositeId, `Billing ${billingId}/${itemId}`, record);
    addEdge(nodeId("BillingDocument", billingId), nodeId("BillingItem", compositeId), "HAS_ITEM");
    if (deliveryItemMap.has(`${referenceDelivery}-${referenceItem}`)) {
      addEdge(
        nodeId("BillingItem", compositeId),
        nodeId("DeliveryItem", `${referenceDelivery}-${referenceItem}`),
        "BILLS_DELIVERY_ITEM"
      );
      addEdge(nodeId("BillingDocument", billingId), nodeId("Delivery", referenceDelivery), "BILLS_DELIVERY");
    }
    if (productMap.has(product)) {
      addEdge(nodeId("BillingItem", compositeId), nodeId("Product", product), "FOR_PRODUCT");
    }
  }

  for (const record of journals) {
    const accountingDocument = clean(record.accountingDocument);
    journalMap.set(accountingDocument, record);
    addNode("JournalEntry", accountingDocument, `Journal ${accountingDocument}`, record);
    if (billingMap.has(clean(record.referenceDocument))) {
      addEdge(
        nodeId("BillingDocument", clean(record.referenceDocument)),
        nodeId("JournalEntry", accountingDocument),
        "POSTED_TO"
      );
    }
    if (customerMap.has(clean(record.customer))) {
      addEdge(
        nodeId("JournalEntry", accountingDocument),
        nodeId("Customer", clean(record.customer)),
        "RECEIVABLE_FOR"
      );
    }
  }

  for (const record of payments) {
    const clearingDocument = clean(record.clearingAccountingDocument);
    if (!clearingDocument) {
      continue;
    }
    const id = clearingDocument;
    const existing = paymentMap.get(id) || {
      paymentId: id,
      accountingDocuments: new Set(),
      customers: new Set(),
      companyCode: clean(record.companyCode),
      fiscalYear: clean(record.fiscalYear),
      postingDate: clean(record.postingDate),
      clearingDate: clean(record.clearingDate),
      amountInCompanyCodeCurrency: 0,
      transactionCurrency: clean(record.transactionCurrency)
    };
    existing.accountingDocuments.add(clean(record.accountingDocument));
    if (clean(record.customer)) {
      existing.customers.add(clean(record.customer));
    }
    existing.amountInCompanyCodeCurrency += money(record.amountInCompanyCodeCurrency);
    paymentMap.set(id, existing);
  }

  for (const payment of paymentMap.values()) {
    addNode("Payment", payment.paymentId, `Payment ${payment.paymentId}`, {
      ...payment,
      accountingDocuments: Array.from(payment.accountingDocuments),
      customers: Array.from(payment.customers)
    });
    for (const accountingDocument of payment.accountingDocuments) {
      if (journalMap.has(accountingDocument)) {
        addEdge(
          nodeId("Payment", payment.paymentId),
          nodeId("JournalEntry", accountingDocument),
          "CLEARS"
        );
      }
    }
    for (const customer of payment.customers) {
      if (customerMap.has(customer)) {
        addEdge(nodeId("Payment", payment.paymentId), nodeId("Customer", customer), "RECEIVED_FROM");
      }
    }
  }

  const overview = {
    nodeCount: nodes.size,
    edgeCount: edges.length,
    countsByType: Array.from(nodes.values()).reduce((acc, node) => {
      acc[node.type] = (acc[node.type] || 0) + 1;
      return acc;
    }, {})
  };

  return {
    nodes,
    edges,
    adjacency,
    overview,
    indexes: {
      salesOrders,
      salesOrderItemMap,
      deliveryMap,
      deliveryItemMap,
      billingMap,
      billingItemMap,
      journalMap,
      paymentMap,
      customerMap,
      productMap,
      plantMap
    }
  };
}

function getNeighborhood(graph, rootId, depth = 1, limit = 140) {
  const visited = new Set();
  const queue = [{ id: rootId, depth: 0 }];
  const collectedNodeIds = [];

  while (queue.length > 0 && collectedNodeIds.length < limit) {
    const current = queue.shift();
    if (visited.has(current.id) || !graph.nodes.has(current.id)) {
      continue;
    }
    visited.add(current.id);
    collectedNodeIds.push(current.id);
    if (current.depth >= depth) {
      continue;
    }
    const neighbors = Array.from(graph.adjacency.get(current.id) || []);
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push({ id: neighbor, depth: current.depth + 1 });
      }
    }
  }

  const nodeSet = new Set(collectedNodeIds);
  const edges = graph.edges.filter(
    (edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target)
  );
  const nodes = collectedNodeIds.map((id) => graph.nodes.get(id));

  return { nodes, edges };
}

function searchNodes(graph, query, limit = 12) {
  const needle = clean(query).toLowerCase();
  if (!needle) {
    return [];
  }
  return Array.from(graph.nodes.values())
    .filter((node) => {
      const haystack = [
        node.id,
        node.label,
        node.entityId,
        ...Object.values(node.metadata || {}).map((value) =>
          typeof value === "string" ? value : ""
        )
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, limit);
}

module.exports = {
  loadDataset,
  getNeighborhood,
  searchNodes,
  normalizeItem,
  nodeId
};
