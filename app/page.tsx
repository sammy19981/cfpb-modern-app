import ComplaintAnalyzer from "@/components/complaint-analyzer";
import { Sparkles } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-12 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-1.5 text-xs font-medium text-zinc-300 backdrop-blur-xl">
            <Sparkles className="h-3.5 w-3.5 text-blue-400" />
            6 specialized agents · live CFPB data feed
          </div>
          <h1 className="bg-gradient-to-br from-white via-zinc-200 to-zinc-500 bg-clip-text pb-2 text-5xl font-bold tracking-tight text-transparent sm:text-6xl lg:text-7xl">
            CFPB Complaint Agent
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-zinc-400 sm:text-lg">
            An autonomous resolution pipeline that pulls real complaints from the CFPB
            Consumer Complaint Database, then classifies, risk-scores, root-causes, routes,
            and drafts a ready-to-send response — hands-off, in real time.
          </p>
        </header>

        <ComplaintAnalyzer />

        <footer className="mt-20 border-t border-zinc-900 pt-8 text-center text-xs text-zinc-600">
          <p>
            Built with Next.js 15 · React 19 · Tailwind v4 · OpenAI gpt-4o-mini · Motion
          </p>
        </footer>
      </div>
    </main>
  );
}
