// CFPB Consumer Complaint Database API client
// Docs: https://cfpb.github.io/api/ccdb/
// Notes:
//   - Do NOT pass `format=json` — that switches the endpoint into a full export
//     dump (hundreds of MB). Without it, you get a normal Elasticsearch search
//     response.
//   - The endpoint is slow on a cold cache (~8s), but very fast (~250ms) once
//     the response is cached at CFPB's CDN. We keep an in-process pool of
//     pre-fetched complaints so the user only pays the first hit once.
//   - CFPB requires `frm` to be 0 or a multiple of `size`.

const CFPB_SEARCH_URL =
  "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/";

export type CFPBComplaint = {
  id: string;
  narrative: string;
  product: string;
  sub_product?: string;
  issue?: string;
  sub_issue?: string;
  company?: string;
  state?: string;
  date_received?: string;
};

type CFPBSource = {
  complaint_id?: string | number;
  complaint_what_happened?: string;
  product?: string;
  sub_product?: string;
  issue?: string;
  sub_issue?: string;
  company?: string;
  state?: string;
  date_received?: string;
};

type CFPBHit = {
  _id?: string;
  _source: CFPBSource;
};

// CFPB returns a wrapped Elasticsearch response: { hits: { hits: [...] } }
// We also accept a flat array as a defensive fallback.
type CFPBResponse =
  | CFPBHit[]
  | {
      hits?: {
        hits?: CFPBHit[];
      };
    };

export type FetchOptions = {
  size?: number;
  product?: string;
  excludeIds?: Set<string>;
};

async function rawFetchComplaints(
  size: number,
  frm: number
): Promise<CFPBComplaint[]> {
  const params = new URLSearchParams({
    has_narrative: "true",
    size: String(size),
    frm: String(frm),
    sort: "created_date_desc",
    no_aggs: "true",
  });

  const url = `${CFPB_SEARCH_URL}?${params.toString()}`;

  // Abort if CFPB is being slow — we'd rather surface a friendly error than hang.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "application/json",
        // CFPB's CDN rejects requests without a real UA.
        "User-Agent":
          "cfpb-modern-app/1.0 (+https://github.com/) Mozilla/5.0 (compatible)",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error("CFPB API timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `CFPB API returned ${res.status}: ${res.statusText}${
        body ? ` — ${body.slice(0, 200)}` : ""
      }`
    );
  }

  const data = (await res.json()) as CFPBResponse;
  const hits: CFPBHit[] = Array.isArray(data) ? data : data.hits?.hits ?? [];

  const complaints: CFPBComplaint[] = [];
  for (const hit of hits) {
    const src = hit._source;
    const narrative = (src.complaint_what_happened || "").trim();
    const id = src.complaint_id != null ? String(src.complaint_id) : "";
    if (!id || narrative.length < 50) continue;
    complaints.push({
      id,
      narrative,
      product: src.product || "Unknown",
      sub_product: src.sub_product,
      issue: src.issue,
      sub_issue: src.sub_issue,
      company: src.company,
      state: src.state,
      date_received: src.date_received,
    });
  }

  return complaints;
}

// ---------------------------------------------------------------------------
// In-process pool — survives between requests in a single Next.js dev/prod
// process. Lets us pay the cold CFPB latency once and serve subsequent
// auto-pilot calls instantly.
// ---------------------------------------------------------------------------
type Pool = {
  complaints: CFPBComplaint[];
  fetchedAt: number;
};

const POOL_TTL_MS = 5 * 60 * 1000; // 5 minutes
const POOL_SIZE = 25;
let pool: Pool | null = null;
let inflight: Promise<Pool> | null = null;

async function refreshPool(): Promise<Pool> {
  if (inflight) return inflight;
  inflight = (async () => {
    // Use a random shallow page so different demo runs see different complaints.
    const page = Math.floor(Math.random() * 6); // 0..5
    const frm = page * POOL_SIZE;
    const complaints = await rawFetchComplaints(POOL_SIZE, frm);
    pool = { complaints, fetchedAt: Date.now() };
    return pool;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

function poolIsFresh(p: Pool | null): p is Pool {
  return !!p && Date.now() - p.fetchedAt < POOL_TTL_MS;
}

/**
 * Pull a random recent complaint with a narrative, drawing from a cached pool
 * to keep latency low across repeated auto-pilot calls.
 */
export async function fetchRandomComplaint(
  excludeIds?: Set<string>
): Promise<CFPBComplaint | null> {
  if (!poolIsFresh(pool)) {
    await refreshPool();
  }

  let candidates = (pool?.complaints ?? []).filter(
    (c) => !excludeIds?.has(c.id)
  );

  // Pool exhausted — refresh once.
  if (candidates.length === 0) {
    await refreshPool();
    candidates = (pool?.complaints ?? []).filter(
      (c) => !excludeIds?.has(c.id)
    );
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
