import ReactMarkdown from 'react-markdown'

/**
 * PUBLIC MARKDOWN (SEO-UPGRADE · PHASE 6) — renders blog-post Markdown in a
 * server component. react-markdown skips raw HTML by default (XSS-safe for
 * staff-authored content), and the component map below styles the output in
 * the site's design language without needing the typography plugin.
 */

export function Markdown({ source }: { source: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        components={{
          h1: (p) => <h2 className="mt-10 text-2xl font-bold tracking-tight text-slate-50" {...p} />,
          h2: (p) => <h2 className="mt-10 text-2xl font-bold tracking-tight text-slate-50" {...p} />,
          h3: (p) => <h3 className="mt-8 text-xl font-semibold text-slate-100" {...p} />,
          h4: (p) => <h4 className="mt-6 text-lg font-semibold text-slate-100" {...p} />,
          p: (p) => <p className="mt-4 text-[0.9375rem] leading-[1.8] text-slate-300" {...p} />,
          ul: (p) => <ul className="mt-4 list-disc space-y-2 pl-5 text-[0.9375rem] leading-[1.8] text-slate-300" {...p} />,
          ol: (p) => <ol className="mt-4 list-decimal space-y-2 pl-5 text-[0.9375rem] leading-[1.8] text-slate-300" {...p} />,
          li: (p) => <li className="pl-1" {...p} />,
          strong: (p) => <strong className="font-semibold text-slate-100" {...p} />,
          em: (p) => <em className="italic text-slate-200" {...p} />,
          a: ({ href, children }) => (
            <a href={href} className="text-emerald-400 underline-offset-4 hover:underline">
              {children}
            </a>
          ),
          blockquote: (p) => (
            <blockquote className="mt-6 rounded-r-2xl border-l-2 border-emerald-500/60 bg-emerald-500/[0.05] py-1 pl-5 pr-4 text-slate-300" {...p} />
          ),
          code: ({ className, children, ...rest }) => {
            const isBlock = Boolean(className)
            if (isBlock) {
              return (
                <code className="mt-5 block overflow-x-auto rounded-2xl border border-slate-800/70 bg-[#0b1220] p-4 font-mono text-[0.8125rem] leading-relaxed text-emerald-100/90" {...rest}>
                  {children}
                </code>
              )
            }
            return (
              <code className="rounded-md bg-slate-800/70 px-1.5 py-0.5 font-mono text-[0.85em] text-emerald-200" {...rest}>
                {children}
              </code>
            )
          },
          pre: (p) => <pre className="mt-0 whitespace-pre-wrap" {...p} />,
          hr: () => <hr className="mt-10 border-slate-800/70" />,
          table: (p) => (
            <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-800/70">
              <table className="w-full text-left text-sm" {...p} />
            </div>
          ),
          th: (p) => <th className="border-b border-slate-800/70 bg-slate-900/50 px-4 py-2.5 font-semibold text-slate-200" {...p} />,
          td: (p) => <td className="border-b border-slate-800/40 px-4 py-2.5 text-slate-300" {...p} />,
          img: ({ src, alt }) =>
            typeof src === 'string' ? (
              <span className="mt-6 block">
                { }
                <img src={src} alt={alt ?? ''} loading="lazy" className="rounded-2xl border border-slate-800/70" />
              </span>
            ) : null,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
