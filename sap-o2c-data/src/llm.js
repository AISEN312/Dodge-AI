async function geminiPlan(question) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const prompt = `
You are planning data-grounded queries for an order-to-cash dataset.
Return only minified JSON with this schema:
{"intent":"top_billed_products|trace_billing_document|find_incomplete_sales_orders|linked_journal_for_billing|document_lookup|unsupported","billingDocumentId":"string|null","identifier":"string|null","limit":number|null}

Rules:
- Only choose from the allowed intents.
- If the question is outside the dataset domain, return {"intent":"unsupported"}.
- Billing documents, sales orders, deliveries, journal entries, payments, customers, plants, and products may appear.
- Never invent fields or extra keys.

Question: ${JSON.stringify(question)}
  `.trim();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json"
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini planning failed with status ${response.status}`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = {
  geminiPlan
};
