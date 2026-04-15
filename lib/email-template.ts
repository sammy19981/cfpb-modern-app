// Branded HTML email template for customer resolution responses.
// Used by /api/send-email to render the resolution package into a
// professional email suitable for sending to CFPB complainants.

type ResolutionInput = {
  complaint_id: string;
  resolution: {
    resolution_summary?: string;
    customer_response?: {
      subject_line?: string;
      body?: string;
      tone?: string;
      follow_up_required?: boolean;
    };
    remediation_steps?: Array<{
      step?: number;
      action?: string;
      responsible_team?: string;
      deadline_days?: number;
      details?: string;
    }>;
    financial_remediation?: {
      refund_recommended?: boolean;
      compensation_type?: string;
      estimated_amount?: string;
    };
  };
  router?: {
    routed_to_team?: string;
    priority_level?: string;
    sla_hours?: number;
  };
};

const escape = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const nl2br = (s: unknown): string => escape(s).replace(/\n/g, "<br>");

export function buildCustomerEmailHtml(pkg: ResolutionInput): {
  subject: string;
  html: string;
} {
  const res = pkg.resolution || {};
  const cr = res.customer_response || {};
  const subject =
    cr.subject_line || "Update regarding your recent complaint";
  const refund = res.financial_remediation;

  const remediationRows = (res.remediation_steps || [])
    .map(
      (step) => `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;vertical-align:top;width:44px;">
          <div style="width:28px;height:28px;border-radius:8px;background:#eef2ff;color:#4f46e5;font-weight:700;font-size:13px;line-height:28px;text-align:center;">${escape(
            step.step
          )}</div>
        </td>
        <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
          <div style="color:#0f172a;font-weight:600;font-size:14px;line-height:1.45;">${escape(
            step.action
          )}</div>
          <div style="margin-top:6px;color:#64748b;font-size:12px;">
            ${escape((step.responsible_team || "").replace(/_/g, " "))} ·
            ${escape(step.deadline_days || "—")} day${
              step.deadline_days === 1 ? "" : "s"
            }
          </div>
          ${
            step.details
              ? `<div style="margin-top:8px;color:#475569;font-size:13px;line-height:1.5;">${escape(
                  step.details
                )}</div>`
              : ""
          }
        </td>
      </tr>`
    )
    .join("");

  const refundCard =
    refund && refund.refund_recommended
      ? `
      <div style="margin:24px 0;padding:18px 20px;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:12px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#047857;margin-bottom:6px;">
          Financial Remediation
        </div>
        <div style="color:#064e3b;font-size:15px;font-weight:600;">
          ${escape(refund.compensation_type || "Refund")} · ${escape(
            refund.estimated_amount || ""
          )}
        </div>
      </div>`
      : "";

  const followUp = cr.follow_up_required
    ? `
      <div style="margin-top:24px;padding:16px 20px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:8px;">
        <div style="color:#92400e;font-size:13px;line-height:1.5;">
          <strong>Follow-up scheduled.</strong> A member of our team will contact you with a status update.
        </div>
      </div>`
    : "";

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="padding:28px 32px;background:linear-gradient(135deg,#4338ca 0%,#6366f1 100%);">
              <div style="color:#c7d2fe;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">
                Customer Resolution
              </div>
              <div style="margin-top:6px;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3;">
                ${escape(subject)}
              </div>
              <div style="margin-top:10px;color:#c7d2fe;font-size:12px;">
                Case reference: ${escape(pkg.complaint_id)}
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <div style="color:#334155;font-size:15px;line-height:1.65;">
                ${nl2br(cr.body) || nl2br(res.resolution_summary)}
              </div>
            </td>
          </tr>

          ${
            refundCard
              ? `<tr><td style="padding:0 32px;">${refundCard}</td></tr>`
              : ""
          }

          ${
            remediationRows
              ? `
          <tr>
            <td style="padding:8px 32px 0 32px;">
              <div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;margin:16px 0 10px 0;">
                What Happens Next
              </div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
                ${remediationRows}
              </table>
            </td>
          </tr>`
              : ""
          }

          ${followUp ? `<tr><td style="padding:0 32px;">${followUp}</td></tr>` : ""}

          <tr>
            <td style="padding:28px 32px 32px 32px;">
              <div style="height:1px;background:#e5e7eb;margin-bottom:20px;"></div>
              <div style="color:#64748b;font-size:12px;line-height:1.6;">
                This response was generated by our AI-assisted resolution pipeline and reviewed in accordance with federal consumer protection regulations. If you have questions, please reply to this email and reference case <strong>${escape(
                  pkg.complaint_id
                )}</strong>.
              </div>
              <div style="margin-top:14px;color:#94a3b8;font-size:11px;">
                CFPB Complaint Resolution Agent · UMD Agentic AI Challenge 2026
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
