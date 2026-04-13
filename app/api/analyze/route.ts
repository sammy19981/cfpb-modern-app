import { NextRequest } from "next/server";
import {
  callAgent,
  buildRouterInput,
  buildResolutionInput,
  computeRequiresHumanReview,
} from "@/lib/orchestrator";
import { AgentKey } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StreamEvent =
  | { type: "start"; agent: AgentKey; ts: number }
  | { type: "complete"; agent: AgentKey; result: Record<string, unknown>; elapsed: number }
  | { type: "error"; agent?: AgentKey; message: string }
  | { type: "done"; package: Record<string, unknown> };

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY is not set. Copy .env.local.example to .env.local and add your key." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: { narrative?: string; complaintId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const narrative = (body.narrative || "").trim();
  const complaintId = body.complaintId || `CFPB-${Date.now()}`;

  if (narrative.length < 20) {
    return new Response(
      JSON.stringify({ error: "Narrative must be at least 20 characters" }),
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      const runAgent = async (agent: AgentKey, input: string) => {
        const startTs = Date.now();
        send({ type: "start", agent, ts: startTs });
        try {
          const result = await callAgent(agent, input);
          send({
            type: "complete",
            agent,
            result,
            elapsed: (Date.now() - startTs) / 1000,
          });
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          send({ type: "error", agent, message });
          throw err;
        }
      };

      try {
        // Stage 1: run four analysis agents in parallel
        const stage1Keys: AgentKey[] = [
          "classifier",
          "compliance",
          "rootCause",
          "sentiment",
        ];
        const stage1Results = await Promise.all(
          stage1Keys.map((key) => runAgent(key, narrative))
        );

        const stage1 = {
          classifier: stage1Results[0],
          compliance: stage1Results[1],
          rootCause: stage1Results[2],
          sentiment: stage1Results[3],
        };

        // Stage 2: router (has full context)
        const router = await runAgent("router", buildRouterInput(narrative, stage1));

        // Stage 3: resolution (has everything)
        const resolution = await runAgent(
          "resolution",
          buildResolutionInput(narrative, stage1, router)
        );

        const requiresHumanReview = computeRequiresHumanReview(
          stage1.classifier,
          stage1.compliance,
          router
        );

        send({
          type: "done",
          package: {
            complaint_id: complaintId,
            complaint_narrative: narrative,
            ...stage1,
            router,
            resolution,
            requires_human_review: requiresHumanReview,
            metadata: {
              model: process.env.OPENAI_MODEL || "gpt-4o-mini",
              processed_at: new Date().toISOString(),
            },
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Pipeline error";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
