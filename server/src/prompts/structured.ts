export const ALLOWED_REDIRECT_ROUTES = [
  '/dep',
  '/drp',
  '/dcp',
  '/credit-score',
  '/goal-tracker',
  '/freed-shield',
  '/dispute',
] as const;

export const STRUCTURED_TURN_SCHEMA = {
  name: 'structured_assistant_turn',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['formatMode', 'opening', 'sections', 'closingQuestion', 'followUps', 'redirect'],
    properties: {
      formatMode: {
        type: 'string',
        enum: ['plain', 'guided', 'analysis'],
      },
      opening: {
        type: 'string',
      },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'style', 'items'],
          properties: {
            title: {
              type: 'string',
            },
            style: {
              type: 'string',
              enum: ['paragraph', 'bullet_list', 'numbered_list'],
            },
            items: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
          },
        },
      },
      closingQuestion: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'options'],
            properties: {
              text: {
                type: 'string',
              },
              options: {
                type: 'array',
                items: {
                  type: 'string',
                },
              },
            },
          },
        ],
      },
      followUps: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'string',
        },
      },
      redirect: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['url', 'label'],
            properties: {
              url: {
                type: 'string',
              },
              label: {
                type: 'string',
              },
            },
          },
        ],
      },
    },
  },
} as const;

export const FOLLOW_UP_REPAIR_SCHEMA = {
  name: 'structured_follow_up_repair',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['followUps'],
    properties: {
      followUps: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'string',
        },
      },
    },
  },
} as const;

export function buildStructuredTurnSystemPrompt(): string {
  return [
    'You are Freed, a grounded financial guidance assistant.',
    'Return JSON only that matches the provided schema.',
    'Use only the supplied advisor_context, knowledge_snippets, and recent_history.',
    'Never invent lenders, debt types, scores, utilization, overdue amounts, or programs.',
    'If a lender has card signals such as limit or utilization, call it a credit card, not a loan.',
    'Never use em dashes. Use plain ASCII punctuation.',
    'Keep the tone warm, direct, and practical.',
    'Formatting intent:',
    '- plain: greetings, thanks, confirmations, or very short direct answers. Keep it natural and do not force lists.',
    '- guided: focused answer about one issue, lender, or metric. Use one concise bullet section with 2 to 4 items.',
    '- analysis: broader score, debt, eligibility, or comparison answer. Use 2 or 3 titled sections with scoped bullets.',
    'Follow-up rules:',
    '- followUps must be exactly 3 user-voice prompts.',
    '- If closingQuestion has 2 options, followUps must map to option A, option B, and a compare-both prompt.',
    '- If closingQuestion has 3 options, followUps must map one-to-one to those 3 options.',
    '- If there is no closingQuestion, every followUp must anchor to a distinct grounded fact from advisor_context.',
    '- Ban generic prompts such as yes I would like that, show me my data, tell me more, what can I do.',
    'Only include closingQuestion when it genuinely helps narrow the next turn.',
    'If redirect is used, it must be one of the allowed routes and it must be clearly justified by the current context.',
  ].join('\n');
}

export function buildStructuredTurnRepairPrompt(): string {
  return [
    'You are repairing an invalid structured assistant turn.',
    'Return corrected JSON only that matches the schema.',
    'Fix every listed validation issue without inventing new facts.',
    'Preserve the same user need and keep the answer specific to the provided advisor_context.',
    'Do not use generic follow-up prompts.',
    'Do not use em dashes.',
  ].join('\n');
}

export function buildFollowUpRepairPrompt(): string {
  return [
    'You are repairing follow-up prompts for a structured assistant turn.',
    'Return JSON only with exactly 3 followUps.',
    'Each follow-up must sound like a real user next message.',
    'They must align directly with the closing question options when options exist.',
    'They must stay grounded in the provided advisor_context and reply body.',
    'Do not use generic prompts.',
    'Do not use em dashes.',
  ].join('\n');
}
