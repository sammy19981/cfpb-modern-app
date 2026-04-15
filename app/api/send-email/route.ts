import { NextRequest } from "next/server";
import nodemailer from "nodemailer";
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
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return Response.json(
      {
        error:
          "Email sender not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env.local (or Vercel env vars). See https://myaccount.google.com/apppasswords to generate an app password.",
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

  const fromName = process.env.GMAIL_FROM_NAME || "CFPB Resolution Agent";
  const from = `"${fromName}" <${GMAIL_USER}>`;

  // Gmail SMTP via app password — works with any Gmail account, no domain
  // needed. App passwords: https://myaccount.google.com/apppasswords
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
    });

    return Response.json({
      ok: true,
      id: info.messageId,
      to,
      subject,
      from,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown send error";
    // Nodemailer auth errors are common — surface a helpful hint.
    const hint = /invalid login|535|Username and Password not accepted/i.test(
      message
    )
      ? " — check that GMAIL_APP_PASSWORD is a 16-character app password (not your regular Gmail password) and that 2-Step Verification is enabled on the Google account."
      : "";
    return Response.json({ error: message + hint }, { status: 502 });
  }
}
