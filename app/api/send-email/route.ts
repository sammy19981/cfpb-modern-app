import { NextRequest } from "next/server";
import { Resend } from "resend";
import { buildCustomerEmailHtml } from "@/lib/email-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Basic RFC-5322-ish email validator. Good enough for a client-side-validated form.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Body = {
  to?: string;
  complaint_id?: string;
  resolution?: Record<string, unknown>;
  router?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  if (!process.env.RESEND_API_KEY) {
    return Response.json(
      {
        error:
          "RESEND_API_KEY is not set on the server. Add it to .env.local (or Vercel env vars) and redeploy.",
      },
      { status: 500 }
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = (body.to || "").trim();
  if (!EMAIL_RE.test(to)) {
    return Response.json(
      { error: "Please provide a valid recipient email address." },
      { status: 400 }
    );
  }

  if (!body.resolution || !body.complaint_id) {
    return Response.json(
      { error: "Missing resolution package or complaint_id." },
      { status: 400 }
    );
  }

  // Build the branded HTML email from the resolution package.
  const { subject, html } = buildCustomerEmailHtml({
    complaint_id: body.complaint_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolution: body.resolution as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router: body.router as any,
  });

  const resend = new Resend(process.env.RESEND_API_KEY);

  // Resend requires a verified sender. Default to their sandbox sender
  // unless the user has configured their own domain via RESEND_FROM_EMAIL.
  // Sandbox sender can only deliver to the Resend account owner's address.
  const from =
    process.env.RESEND_FROM_EMAIL ||
    "CFPB Resolution Agent <onboarding@resend.dev>";

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
    });

    if (error) {
      return Response.json(
        { error: error.message || "Resend rejected the email" },
        { status: 502 }
      );
    }

    return Response.json({
      ok: true,
      id: data?.id,
      to,
      subject,
      from,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown send error";
    return Response.json({ error: message }, { status: 502 });
  }
}
