import OpenAI from "openai";
import { AGENTS, AgentKey } from "./prompts";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export async function callAgent(
  agentKey: AgentKey,
  userMessage: string
): Promise<Record<string, unknown>> {
  const agent = AGENTS[agentKey];

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: agent.systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: agent.temperature,
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content || "{}";
  try {
    return JSON.parse(content);
  } catch {
    return { error: "Failed to parse agent response", raw: content };
  }
}

export function buildRouterInput(
  narrative: string,
  stage1: Record<string, unknown>
): string {
  return `Route this consumer complaint to the appropriate team.

COMPLAINT:
${narrative}

PRIOR ANALYSIS FROM OTHER AGENTS:
Classification: ${JSON.stringify(stage1.classifier, null, 2)}
Compliance: ${JSON.stringify(stage1.compliance, null, 2)}
Root Cause: ${JSON.stringify(stage1.rootCause, null, 2)}
Sentiment: ${JSON.stringify(stage1.sentiment, null, 2)}`;
}

export function buildResolutionInput(
  narrative: string,
  stage1: Record<string, unknown>,
  router: unknown
): string {
  return `Generate a complete resolution plan for this consumer complaint.

COMPLAINT:
${narrative}

COMPLETE PRIOR ANALYSIS:
Classification: ${JSON.stringify(stage1.classifier, null, 2)}
Compliance: ${JSON.stringify(stage1.compliance, null, 2)}
Root Cause: ${JSON.stringify(stage1.rootCause, null, 2)}
Sentiment: ${JSON.stringify(stage1.sentiment, null, 2)}
Routing: ${JSON.stringify(router, null, 2)}`;
}

export function computeRequiresHumanReview(
  classification: Record<string, unknown>,
  compliance: Record<string, unknown>,
  routing: Record<string, unknown>
): boolean {
  const severity = Number(classification?.severity) || 0;
  const riskLevel = String(compliance?.risk_level || "LOW").toUpperCase();
  const legalReview = routing?.requires_legal_review === true;

  return (
    severity >= 4 ||
    riskLevel === "HIGH" ||
    riskLevel === "CRITICAL" ||
    legalReview
  );
}
