import { ArogyaWordmark } from "@/components/brand/arogya-mark";

const FOOTER_COLUMNS: { heading: string; links: string[] }[] = [
  {
    heading: "product",
    links: ["features", "modules", "security", "pricing"],
  },
  {
    heading: "modules",
    links: [
      "records-core",
      "scheduling",
      "billing-engine",
      "pharmacy-dispense",
      "telehealth",
      "analytics",
    ],
  },
  {
    heading: "resources",
    links: ["documentation", "api-reference", "compliance", "status"],
  },
  {
    heading: "company",
    links: ["about", "careers", "press", "contact"],
  },
];

function FooterLink({ children }: { children: string }) {
  return (
    <a
      href="#"
      onClick={(e) => e.preventDefault()}
      className="block w-fit font-mono text-[13px] text-muted-foreground transition-colors hover:text-ok"
    >
      {children}
    </a>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border/70 bg-card/60">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <ArogyaWordmark />
            <p className="mt-4 max-w-xs font-mono text-[13px] leading-6 text-muted-foreground">
              One operating system for the business of care — records,
              scheduling, billing, and analytics on a single HIPAA-ready
              kernel.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-md border border-border/80 bg-background px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-ok" />
              status: <span className="text-ok">operational</span>
            </div>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading}>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
                {col.heading}
              </p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link}>
                    <FooterLink>{link}</FooterLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* status bar */}
      <div className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 font-mono text-[11px] text-muted-foreground sm:flex-row sm:px-6">
          <span className="tnum">AROGYAOS v0.1.0-beta · built for care teams</span>
          <span className="tnum">© 2026 arogya systems · all rights reserved</span>
        </div>
      </div>
    </footer>
  );
}
