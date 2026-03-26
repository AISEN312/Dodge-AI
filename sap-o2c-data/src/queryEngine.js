const { normalizeItem, nodeId, searchNodes } = require("./data");

function topBilledProducts(graph, limit = 5) {
  const counts = new Map();
  const supportingNodes = new Set();

  for (const item of graph.indexes.billingItemMap.values()) {
    const productId = String(item.material || "").trim();
    if (!productId) {
      continue;
    }
    const entry = counts.get(productId) || {
      productId,
      billingDocumentCount: 0,
      billingItems: 0,
      totalNetAmount: 0
    };
    entry.billingItems += 1;
    entry.billingDocumentCount += 1;
    entry.totalNetAmount += Number(item.netAmount || 0);
    counts.set(productId, entry);
  }

  const ranked = Array.from(counts.values())
    .sort((a, b) => {
      if (b.billingDocumentCount !== a.billingDocumentCount) {
        return b.billingDocumentCount - a.billingDocumentCount;
      }
      return b.totalNetAmount - a.totalNetAmount;
    })
    .slice(0, limit)
    .map((entry, index) => {
      const productNode = graph.nodes.get(nodeId("Product", entry.productId));
      if (productNode) {
        supportingNodes.add(productNode.id);
      }
      return {
        rank: index + 1,
        productId: entry.productId,
        productName: productNode?.label || entry.productId,
        billingDocumentCount: entry.billingDocumentCount,
        billingItems: entry.billingItems,
        totalNetAmount: Number(entry.totalNetAmount.toFixed(2))
      };
    });

  return {
    answer:
      ranked.length === 0
        ? "I could not find any billed products in the dataset."
        : `The most frequently billed products are ${ranked
            .slice(0, 3)
            .map((item) => `${item.productName} (${item.billingDocumentCount} billing items)`)
            .join(", ")}.`,
    data: ranked,
    highlightNodeIds: Array.from(supportingNodes)
  };
}

function traceBillingDocument(graph, billingDocumentId) {
  const billingId = String(billingDocumentId || "").trim();
  const billing = graph.indexes.billingMap.get(billingId);
  if (!billing) {
    return {
      answer: `I could not find billing document ${billingId} in the dataset.`,
      data: null,
      highlightNodeIds: []
    };
  }

  const billingNodeId = nodeId("BillingDocument", billingId);
  const billingItems = Array.from(graph.indexes.billingItemMap.values()).filter(
    (item) => String(item.billingDocument).trim() === billingId
  );
  const deliveryIds = new Set();
  const salesOrderIds = new Set();
  const productIds = new Set();

  for (const item of billingItems) {
    productIds.add(String(item.material || "").trim());
    const deliveryId = String(item.referenceSdDocument || "").trim();
    const deliveryItem = normalizeItem(item.referenceSdDocumentItem);
    if (deliveryId) {
      deliveryIds.add(deliveryId);
      const linkedDeliveryItem = graph.indexes.deliveryItemMap.get(`${deliveryId}-${deliveryItem}`);
      if (linkedDeliveryItem) {
        const soId = String(linkedDeliveryItem.referenceSdDocument || "").trim();
        if (soId) {
          salesOrderIds.add(soId);
        }
      }
    }
  }

  const journal =
    graph.indexes.journalMap.get(String(billing.accountingDocument || "").trim()) ||
    Array.from(graph.indexes.journalMap.values()).find(
      (entry) => String(entry.referenceDocument || "").trim() === billingId
    );
  const payment = journal
    ? Array.from(graph.indexes.paymentMap.values()).find((entry) =>
        entry.accountingDocuments.has(String(journal.accountingDocument).trim())
      )
    : null;

  const highlightNodeIds = [
    billingNodeId,
    ...Array.from(deliveryIds).map((id) => nodeId("Delivery", id)),
    ...Array.from(salesOrderIds).map((id) => nodeId("SalesOrder", id)),
    ...Array.from(productIds).map((id) => nodeId("Product", id))
  ];
  if (journal) {
    highlightNodeIds.push(nodeId("JournalEntry", journal.accountingDocument));
  }
  if (payment) {
    highlightNodeIds.push(nodeId("Payment", payment.paymentId));
  }

  return {
    answer:
      `Billing document ${billingId} links to ${salesOrderIds.size || 0} sales order(s), ` +
      `${deliveryIds.size || 0} delivery document(s), ` +
      `${journal ? `journal entry ${journal.accountingDocument}` : "no journal entry"}` +
      `${payment ? `, and payment ${payment.paymentId}` : ""}.`,
    data: {
      billingDocument: billing,
      salesOrders: Array.from(salesOrderIds).map((id) => graph.indexes.salesOrders.get(id)),
      deliveries: Array.from(deliveryIds).map((id) => graph.indexes.deliveryMap.get(id)),
      billingItems,
      journalEntry: journal || null,
      payment: payment
        ? {
            paymentId: payment.paymentId,
            amountInCompanyCodeCurrency: Number(payment.amountInCompanyCodeCurrency.toFixed(2)),
            transactionCurrency: payment.transactionCurrency,
            postingDate: payment.postingDate,
            clearingDate: payment.clearingDate
          }
        : null
    },
    highlightNodeIds
  };
}

function findIncompleteSalesOrders(graph, limit = 10) {
  const deliveryBySalesOrder = new Map();
  const billingBySalesOrder = new Map();

  for (const deliveryItem of graph.indexes.deliveryItemMap.values()) {
    const orderId = String(deliveryItem.referenceSdDocument || "").trim();
    if (!orderId) {
      continue;
    }
    const bucket = deliveryBySalesOrder.get(orderId) || new Set();
    bucket.add(String(deliveryItem.deliveryDocument || "").trim());
    deliveryBySalesOrder.set(orderId, bucket);
  }

  for (const billingItem of graph.indexes.billingItemMap.values()) {
    const deliveryId = String(billingItem.referenceSdDocument || "").trim();
    const deliveryItemId = normalizeItem(billingItem.referenceSdDocumentItem);
    const deliveryItem = graph.indexes.deliveryItemMap.get(`${deliveryId}-${deliveryItemId}`);
    const orderId = String(deliveryItem?.referenceSdDocument || "").trim();
    if (!orderId) {
      continue;
    }
    const bucket = billingBySalesOrder.get(orderId) || new Set();
    bucket.add(String(billingItem.billingDocument || "").trim());
    billingBySalesOrder.set(orderId, bucket);
  }

  const broken = [];
  for (const [orderId, order] of graph.indexes.salesOrders.entries()) {
    const deliveries = Array.from(deliveryBySalesOrder.get(orderId) || []);
    const billings = Array.from(billingBySalesOrder.get(orderId) || []);
    const issues = [];
    if (deliveries.length > 0 && billings.length === 0) {
      issues.push("Delivered but not billed");
    }
    if (deliveries.length === 0 && billings.length > 0) {
      issues.push("Billed without delivery");
    }
    if (String(order.overallDeliveryStatus || "").trim() === "C" && deliveries.length === 0) {
      issues.push("Header shows complete delivery status without delivery item linkage");
    }
    if (issues.length > 0) {
      broken.push({
        salesOrder: orderId,
        soldToParty: order.soldToParty,
        totalNetAmount: Number(order.totalNetAmount || 0),
        deliveries,
        billings,
        issues
      });
    }
  }

  const result = broken
    .sort((a, b) => b.totalNetAmount - a.totalNetAmount)
    .slice(0, limit);

  return {
    answer:
      result.length === 0
        ? "I did not find broken sales-order flows with the current rules."
        : `I found ${result.length} sales orders with incomplete or inconsistent downstream flow.`,
    data: result,
    highlightNodeIds: result.map((item) => nodeId("SalesOrder", item.salesOrder))
  };
}

function linkedJournalForBilling(graph, billingDocumentId) {
  const billingId = String(billingDocumentId || "").trim();
  const journal =
    Array.from(graph.indexes.journalMap.values()).find(
      (entry) => String(entry.referenceDocument || "").trim() === billingId
    ) || null;

  if (!journal) {
    return {
      answer: `I could not find a journal entry linked to billing document ${billingId}.`,
      data: null,
      highlightNodeIds: []
    };
  }

  return {
    answer: `The journal entry linked to billing document ${billingId} is ${journal.accountingDocument}.`,
    data: journal,
    highlightNodeIds: [
      nodeId("BillingDocument", billingId),
      nodeId("JournalEntry", journal.accountingDocument)
    ]
  };
}

function documentLookup(graph, identifier) {
  const id = String(identifier || "").trim();
  const candidates = [
    nodeId("BillingDocument", id),
    nodeId("SalesOrder", id),
    nodeId("Delivery", id),
    nodeId("JournalEntry", id),
    nodeId("Payment", id),
    nodeId("Customer", id),
    nodeId("Product", id)
  ];

  for (const candidate of candidates) {
    if (graph.nodes.has(candidate)) {
      const node = graph.nodes.get(candidate);
      return {
        answer: `I found ${node.type} ${node.entityId}: ${node.label}.`,
        data: node,
        highlightNodeIds: [candidate]
      };
    }
  }

  const searchMatches = searchNodes(graph, id, 6);
  if (searchMatches.length > 0) {
    return {
      answer: `I could not find an exact match for ${id}, but I found ${searchMatches.length} related records.`,
      data: searchMatches,
      highlightNodeIds: searchMatches.map((node) => node.id)
    };
  }

  return {
    answer: `I could not find ${id} in the dataset.`,
    data: null,
    highlightNodeIds: []
  };
}

function isInDomain(question) {
  const text = String(question || "").toLowerCase();
  const domainKeywords = [
    "sales order",
    "delivery",
    "billing",
    "invoice",
    "payment",
    "journal",
    "customer",
    "product",
    "plant",
    "order to cash",
    "material",
    "document",
    "flow"
  ];
  const hasKeyword = domainKeywords.some((keyword) => text.includes(keyword));
  const hasDocumentNumber = /\b\d{6,10}\b/.test(text);
  return hasKeyword || hasDocumentNumber;
}

function heuristicPlan(question) {
  const text = String(question || "").toLowerCase();
  const documentId = (String(question || "").match(/\b\d{6,10}\b/) || [])[0] || null;

  if (
    (text.includes("highest") || text.includes("top") || text.includes("most")) &&
    text.includes("product") &&
    (text.includes("billing") || text.includes("invoice"))
  ) {
    return { intent: "top_billed_products", limit: 5 };
  }

  if (text.includes("trace") && (text.includes("billing") || documentId)) {
    return { intent: "trace_billing_document", billingDocumentId: documentId };
  }

  if (
    text.includes("broken") ||
    text.includes("incomplete") ||
    text.includes("delivered but not billed") ||
    text.includes("billed without delivery")
  ) {
    return { intent: "find_incomplete_sales_orders", limit: 10 };
  }

  if (text.includes("journal") && documentId) {
    return { intent: "linked_journal_for_billing", billingDocumentId: documentId };
  }

  if (documentId) {
    return { intent: "document_lookup", identifier: documentId };
  }

  return { intent: "unsupported" };
}

async function executePlan(graph, plan) {
  switch (plan.intent) {
    case "top_billed_products":
      return topBilledProducts(graph, Number(plan.limit) || 5);
    case "trace_billing_document":
      if (!plan.billingDocumentId) {
        return {
          answer: "Please provide a billing document number to trace.",
          data: null,
          highlightNodeIds: []
        };
      }
      return traceBillingDocument(graph, plan.billingDocumentId);
    case "find_incomplete_sales_orders":
      return findIncompleteSalesOrders(graph, Number(plan.limit) || 10);
    case "linked_journal_for_billing":
      if (!plan.billingDocumentId) {
        return {
          answer: "Please provide a billing document number so I can find the linked journal entry.",
          data: null,
          highlightNodeIds: []
        };
      }
      return linkedJournalForBilling(graph, plan.billingDocumentId);
    case "document_lookup":
      return documentLookup(graph, plan.identifier);
    default:
      return {
        answer: "This system is designed to answer questions related to the provided order-to-cash dataset only.",
        data: null,
        highlightNodeIds: []
      };
  }
}

module.exports = {
  executePlan,
  heuristicPlan,
  isInDomain
};
