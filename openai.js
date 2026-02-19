const OpenAI = require('openai');
const { defaultSalesPrompt } = require('./db');

const REQUIRED_KEYS = ['analysis', 'service', 'pricing', 'proposalDraft', 'emailDraft', 'upsell'];

function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required');
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function normalizeOutput(parsed) {
  const normalized = {};
  for (const key of REQUIRED_KEYS) {
    normalized[key] = String(parsed?.[key] || '').trim();
  }
  return normalized;
}

function repairJson(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) return null;

  const direct = tryParse(raw);
  if (direct) return direct;

  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    const extracted = match[0]
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']');
    const extractedParsed = tryParse(extracted);
    if (extractedParsed) return extractedParsed;
  }
  return null;
}

function tryParse(value) {
  try {
    const parsed = JSON.parse(value);
    const hasKeys = REQUIRED_KEYS.every((k) => Object.prototype.hasOwnProperty.call(parsed, k));
    return hasKeys ? parsed : null;
  } catch (_e) {
    return null;
  }
}

function buildDisclaimerIfNeeded(payload) {
  const missingBudget = !payload.budget || !String(payload.budget).trim();
  const missingTimeline = !payload.timeline || !String(payload.timeline).trim();
  if (!missingBudget && !missingTimeline) return '';
  return payload.language === 'en'
    ? '\n\nDisclaimer: The pricing estimate is indicative and may change after detailed scope validation.'
    : '\n\nДисклеймър: Ценовата оценка е ориентировъчна и може да се промени след детайлно уточняване на обхвата.';
}

async function generateStructuredOutput({ module, language, payload, prompt, snippets = [], templates = [], pricing = [] }) {
  const client = getClient();
  const systemPrompt = prompt || defaultSalesPrompt(language);

  const userText = [
    `MODULE: ${module}`,
    `LANGUAGE: ${language}`,
    `LEAD: ${payload.leadText}`,
    `COMPANY: ${payload.company || 'n/a'}`,
    `INDUSTRY: ${payload.industry || 'n/a'}`,
    `BUDGET: ${payload.budget || 'n/a'}`,
    `TIMELINE: ${payload.timeline || 'n/a'}`,
    `KNOWLEDGE_SNIPPETS:\n${snippets.join('\n\n') || 'none'}`,
    `TEMPLATES:\n${templates.join('\n\n') || 'none'}`,
    `PRICING_RULES:\n${pricing.join('\n') || 'none'}`,
    'Return strict JSON only.'
  ].join('\n');

  const completion = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ]
  });

  const rawOutput = completion.choices?.[0]?.message?.content || '';
  const repaired = repairJson(rawOutput);
  if (!repaired) {
    throw new Error('Model did not return valid JSON output');
  }

  const normalized = normalizeOutput(repaired);
  normalized.pricing += buildDisclaimerIfNeeded({ ...payload, language });

  return {
    output: normalized,
    rawOutput,
    usage: {
      inputTokens: completion.usage?.prompt_tokens || 0,
      outputTokens: completion.usage?.completion_tokens || 0
    }
  };
}

module.exports = {
  REQUIRED_KEYS,
  generateStructuredOutput,
  repairJson
};
