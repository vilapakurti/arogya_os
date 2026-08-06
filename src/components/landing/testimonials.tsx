import { SectionHeading } from "@/components/landing/section-heading";
import { motion } from "framer-motion";

const QUOTES = [
  {
    quote:
      "We decommissioned four legacy systems in one quarter. ArogyaOS is the first platform our clinicians actually trust to run the floor.",
    name: "Dr. Meera Iyer",
    role: "CMIO · St. Mary's Health Network",
    initials: "MI",
  },
  {
    quote:
      "Revenue cycle used to be a month-end scramble. Now it's a dashboard we read before lunch. Denials down 38% in 90 days.",
    name: "Rafael Ortiz",
    role: "VP Finance · Northbridge Clinics",
    initials: "RO",
  },
  {
    quote:
      "The audit trail alone is worth it. Every access decision, every release of information — logged, searchable, defensible.",
    name: "Amara Okafor",
    role: "Privacy Officer · Harbor Regional Health",
    initials: "AO",
  },
];

export function Testimonials() {
  return (
    <section className="border-t border-border/60 bg-card/40 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          kicker="field reports"
          title="Care teams that switched to ArogyaOS"
        />
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {QUOTES.map((t, i) => (
            <motion.figure
              key={t.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.1, duration: 0.45 }}
              className="flex flex-col justify-between rounded-lg border border-border bg-background p-6"
            >
              <div>
                <p className="font-mono text-[11px] text-muted-foreground/60">
                  {"> "}report_{String(i + 1).padStart(3, "0")}
                </p>
                <blockquote className="mt-3 text-[14px] leading-7 text-foreground/85">
                  “{t.quote}”
                </blockquote>
              </div>
              <figcaption className="mt-6 flex items-center gap-3 border-t border-border/60 pt-4">
                <span className="flex size-9 items-center justify-center rounded-md border border-border bg-muted font-mono text-[11px] font-semibold text-foreground">
                  {t.initials}
                </span>
                <div>
                  <p className="font-mono text-[13px] font-semibold text-foreground">
                    {t.name}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {t.role}
                  </p>
                </div>
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
}
