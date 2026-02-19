const OpenAI = require('openai');

const SYSTEM_PROMPT = '<<<PASTE_SYSTEM_PROMPT_HERE>>>';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function normalizeOutput(json) {
  return {
    analysis: String(json.analysis || '').trim(),
    service: String(json.service || '').trim(),
    pricing: String(json.pricing || '').trim(),
    proposalDraft: String(json.proposalDraft || '').trim(),
    emailDraft: String(json.emailDraft || '').trim(),
    upsell: String(json.upsell || '').trim()
  };
}

async function generateProposal(inputPayload) {
  const userMessage = [
    `Запитване: ${inputPayload.leadText}`,
    `Компания: ${inputPayload.company_name || 'Не е посочено'}`,
    `Индустрия: ${inputPayload.industry || 'Не е посочено'}`,
    `Приблизителен бюджет: ${inputPayload.approximate_budget || 'Не е посочено'}`,
    `Очакван срок: ${inputPayload.expected_timeline || 'Не е посочено'}`,
    'Изходът трябва да е изцяло на български език.'
  ].join('\n');

  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: userMessage
      }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'sales_proposal',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            analysis: { type: 'string' },
            service: { type: 'string' },
            pricing: { type: 'string' },
            proposalDraft: { type: 'string' },
            emailDraft: { type: 'string' },
            upsell: { type: 'string' }
          },
          required: [
            'analysis',
            'service',
            'pricing',
            'proposalDraft',
            'emailDraft',
            'upsell'
          ]
        }
      }
    }
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('No model output');
  }

  const parsed = JSON.parse(content);
  return normalizeOutput(parsed);
}

module.exports = {
  generateProposal,
  SYSTEM_PROMPT
};
