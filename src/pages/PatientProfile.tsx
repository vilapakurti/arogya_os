import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import {
  AGE_CATEGORY_LABELS,
  ALCOHOL_OPTIONS,
  BLOOD_GROUP_OPTIONS,
  BMI_CATEGORY_LABELS,
  EMPTY_PATIENT_FORM,
  EXERCISE_LABELS,
  EXERCISE_OPTIONS,
  FAMILY_HISTORY_OPTIONS,
  GENDER_OPTIONS,
  KNOWN_CONDITION_OPTIONS,
  SMOKING_OPTIONS,
  TRIMESTER_OPTIONS,
  ageCategoryOf,
  bmiCategoryOf,
  calculateAge,
  calculateBmi,
  computeProfileCompletion,
  describeSelections,
  formToPatch,
  formToProfile,
  profileToForm,
  savePatientProfile,
  validateHeight,
  validatePhone,
  validateWeight,
  type Medication,
  type Option,
  type PatientForm,
} from "@/lib/patient-profile";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Baby,
  CheckCircle2,
  Dumbbell,
  HeartPulse,
  Loader2,
  Phone,
  Pill,
  Plus,
  ShieldAlert,
  Trash2,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function ChoicePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors",
        active
          ? "border-primary/60 bg-primary/10 text-primary"
          : "border-border/70 bg-background/50 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function MultiCheckGrid({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const hasNone = value.includes("none");
  const toggle = (v: string) => {
    if (v === "none") onChange(hasNone ? [] : ["none"]);
    else if (hasNone) onChange([v]);
    else
      onChange(
        value.includes(v) ? value.filter((x) => x !== v) : [...value, v],
      );
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="group">
      {options.map((opt) => {
        const checked = value.includes(opt.value);
        return (
          <label
            key={opt.value}
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
              checked
                ? "border-primary/50 bg-primary/8 text-foreground"
                : "border-border/70 bg-background/50 text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            <Checkbox
              checked={checked}
              onCheckedChange={() => toggle(opt.value)}
              aria-label={opt.label}
            />
            <span>{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/50 p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 min-h-5 truncate text-sm font-semibold text-foreground">
        {value}
      </div>
      {sub && <div className="mt-1">{sub}</div>}
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.35 }}
      className={cn("glass-card rounded-2xl p-5 sm:p-6", className)}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="font-mono text-base font-semibold text-foreground">{title}</h2>
          {description && (
            <p className="text-xs leading-5 text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </motion.section>
  );
}

const BMI_BADGE_CLASS: Record<string, string> = {
  underweight: "border-warn/40 bg-warn/12 text-warn",
  normal: "border-ok/40 bg-ok/12 text-ok",
  overweight: "border-warn/40 bg-warn/12 text-warn",
  obese: "border-crit/40 bg-crit/12 text-crit",
};

type SaveState = "idle" | "saving" | "saved" | "error";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function PatientProfile() {
  const { user, profile } = useAuth();
  const [form, setForm] = useState<PatientForm>(EMPTY_PATIENT_FORM);
  const [hydrated, setHydrated] = useState(false);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastSavedRef = useRef<string>(JSON.stringify(EMPTY_PATIENT_FORM));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const todayIso = useMemo(
    () => new Date().toLocaleDateString("en-CA"),
    [],
  );

  /* ---- hydrate the form from the stored profile exactly once ---- */
  useEffect(() => {
    if (hydrated || !profile) return;
    const f = profileToForm(profile);
    setForm(f);
    lastSavedRef.current = JSON.stringify(f);
    setHydrated(true);
  }, [profile, hydrated]);

  useEffect(() => {
    if (hydrated) setReady(true);
  }, [hydrated]);

  /* ---- derived fields (live) ---- */
  const age = useMemo(() => calculateAge(form.dateOfBirth || null), [form.dateOfBirth]);
  const ageCat = useMemo(() => ageCategoryOf(age), [age]);
  const bmi = useMemo(() => {
    const h = Number(form.heightCm);
    const w = Number(form.weightKg);
    return calculateBmi(
      form.weightKg.trim() !== "" && Number.isFinite(w) ? w : null,
      form.heightCm.trim() !== "" && Number.isFinite(h) ? h : null,
    );
  }, [form.heightCm, form.weightKg]);
  const bmiCat = useMemo(() => bmiCategoryOf(bmi), [bmi]);
  const completion = useMemo(
    () => computeProfileCompletion(formToProfile(form)),
    [form],
  );

  const heightError = validateHeight(form.heightCm);
  const weightError = validateWeight(form.weightKg);
  const phoneError = validatePhone(form.emergencyPhone);
  const isFemale = form.gender === "female";

  /* ---- debounced auto-save ---- */
  useEffect(() => {
    if (!ready || !user) return;
    const snapshot = JSON.stringify(form);
    if (snapshot === lastSavedRef.current) return;
    setSaveState("saving");
    setSaveError(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        await savePatientProfile(user.id, formToPatch(form));
        lastSavedRef.current = snapshot;
        setSaveState("saved");
        toast.success("Profile Saved Successfully");
        window.setTimeout(
          () => setSaveState((s) => (s === "saved" ? "idle" : s)),
          2500,
        );
      } catch (err) {
        setSaveState("error");
        setSaveError(err instanceof Error ? err.message : String(err));
      }
    }, 900);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [form, ready, user]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  /* ---- state helpers ---- */
  const update = <K extends keyof PatientForm>(key: K, value: PatientForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const updateMed = (index: number, key: keyof Medication, value: string) =>
    setForm((f) => ({
      ...f,
      medications: f.medications.map((m, i) =>
        i === index ? { ...m, [key]: value } : m,
      ),
    }));

  const addMed = () =>
    setForm((f) => ({
      ...f,
      medications: [...f.medications, { name: "", dosage: "", frequency: "" }],
    }));

  const removeMed = (index: number) =>
    setForm((f) => ({
      ...f,
      medications: f.medications.filter((_, i) => i !== index),
    }));

  const saveIndicator = () => {
    if (saveState === "saving")
      return (
        <span className="flex items-center gap-1.5 text-warn">
          <Loader2 className="size-3.5 animate-spin" /> Saving…
        </span>
      );
    if (saveState === "saved")
      return (
        <span className="flex items-center gap-1.5 text-ok">
          <CheckCircle2 className="size-3.5" /> Saved
        </span>
      );
    if (saveState === "error")
      return (
        <span className="flex items-center gap-1.5 text-crit">
          <AlertTriangle className="size-3.5" /> Save failed
        </span>
      );
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="size-1.5 rounded-full bg-ok" /> Autosave on
      </span>
    );
  };

  if (!user) {
    return (
      <div className="glass-card mx-auto max-w-md rounded-2xl p-8 text-center">
        <p className="font-mono text-sm text-muted-foreground">
          Please sign in to manage your patient profile.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-5xl"
    >
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[12px] text-muted-foreground">
            <span className="text-primary">$</span> arogya patient profile
          </p>
          <h1 className="mt-3 font-mono text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Patient Profile
          </h1>
          <p className="mt-2 max-w-xl text-[15px] leading-7 text-muted-foreground">
            Your demographic and health history — used to personalise AI report
            analysis, your health journey, doctor visits, and the voice
            assistant.
          </p>
        </div>
        <div
          aria-live="polite"
          className="glass-card flex items-center rounded-xl px-3 py-2 font-mono text-[11px]"
        >
          {saveIndicator()}
        </div>
      </div>

      {/* incomplete-profile notice */}
      {completion.percent < 100 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.35 }}
          className="mt-6 flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-foreground"
          role="status"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
          <p>
            <span className="font-semibold">Profile {completion.percent}% complete.</span>{" "}
            Complete your health profile to receive personalized AI analysis.
          </p>
        </motion.div>
      )}

      {/* save error */}
      {saveError && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2.5 rounded-xl border border-crit/30 bg-crit/10 px-4 py-3 text-sm text-foreground"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-crit" />
          <div>
            <p className="font-semibold text-crit">Unable to save your profile</p>
            <p className="mt-0.5 text-muted-foreground">{saveError}</p>
          </div>
        </div>
      )}

      {/* Health Snapshot */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4 }}
        className="glass-card mt-8 rounded-2xl p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <HeartPulse className="size-4" />
            </span>
            <h2 className="font-mono text-lg font-semibold text-foreground">
              Health Snapshot
            </h2>
          </div>
          <Badge variant="outline" className="font-mono">
            {completion.percent}% complete
          </Badge>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Age"
            value={age ?? "—"}
            sub={
              ageCat ? (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {AGE_CATEGORY_LABELS[ageCat]}
                </Badge>
              ) : undefined
            }
          />
          <Stat
            label="BMI"
            value={bmi != null ? bmi.toFixed(1) : "—"}
            sub={
              bmiCat ? (
                <Badge className={cn("font-mono text-[10px]", BMI_BADGE_CLASS[bmiCat])}>
                  {BMI_CATEGORY_LABELS[bmiCat]}
                </Badge>
              ) : undefined
            }
          />
          <Stat label="Blood Group" value={form.bloodGroup || "—"} />
          <Stat
            label="Conditions"
            value={
              <span title={describeSelections(form.knownConditions, KNOWN_CONDITION_OPTIONS)}>
                {describeSelections(form.knownConditions, KNOWN_CONDITION_OPTIONS)}
              </span>
            }
          />
          <Stat
            label="Lifestyle"
            value={EXERCISE_LABELS[form.exerciseLevel] ?? "Not set"}
          />
          <Stat
            label="Completion"
            value={<span className="tnum">{completion.percent}%</span>}
            sub={<Progress value={completion.percent} className="h-1.5" />}
          />
        </div>
      </motion.section>

      {/* sections */}
      <div className="mt-6 grid items-start gap-5 lg:grid-cols-2">
        {/* ---- 1. Personal Information ---- */}
        <SectionCard
          icon={User}
          title="Personal Information"
          description="Demographics used across every ArogyaOS AI module."
        >
          <div>
            <Label htmlFor="full-name">Full Name</Label>
            <Input
              id="full-name"
              autoComplete="name"
              placeholder="e.g. Ananya Sharma"
              className="h-11 rounded-xl bg-background/70"
              value={form.fullName}
              onChange={(e) => update("fullName", e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="dob">Date of Birth</Label>
              <Input
                id="dob"
                type="date"
                max={todayIso}
                className="h-11 rounded-xl bg-background/70"
                value={form.dateOfBirth}
                onChange={(e) => update("dateOfBirth", e.target.value)}
              />
            </div>
            <div>
              <Label>Age (auto)</Label>
              <div className="flex h-11 items-center gap-2 rounded-xl border border-border/70 bg-background/40 px-3">
                <span className="tnum font-mono text-sm text-foreground">
                  {age ?? "—"} years
                </span>
                {ageCat && (
                  <Badge variant="outline" className="ml-auto font-mono text-[10px]">
                    {AGE_CATEGORY_LABELS[ageCat]}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div>
            <Label>Gender</Label>
            <div
              className="flex flex-wrap gap-2"
              role="radiogroup"
              aria-label="Gender"
            >
              {GENDER_OPTIONS.map((g) => (
                <ChoicePill
                  key={g.value}
                  active={form.gender === g.value}
                  onClick={() => update("gender", g.value)}
                >
                  {g.label}
                </ChoicePill>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="blood-group">Blood Group</Label>
              <Select
                value={form.bloodGroup}
                onValueChange={(v) => update("bloodGroup", v)}
              >
                <SelectTrigger
                  id="blood-group"
                  className="h-11 rounded-xl bg-background/70"
                >
                  <SelectValue placeholder="Select blood group" />
                </SelectTrigger>
                <SelectContent>
                  {BLOOD_GROUP_OPTIONS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-1">
              <p className="text-xs leading-5 text-muted-foreground">
                BMI is computed automatically from height &amp; weight.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="height">Height (cm)</Label>
              <Input
                id="height"
                type="number"
                inputMode="decimal"
                min={50}
                max={250}
                step="0.1"
                placeholder="e.g. 165"
                className="h-11 rounded-xl bg-background/70"
                value={form.heightCm}
                onChange={(e) => update("heightCm", e.target.value)}
                aria-invalid={heightError ? true : undefined}
              />
              {heightError && (
                <p className="mt-1 text-xs text-crit">{heightError}</p>
              )}
            </div>
            <div>
              <Label htmlFor="weight">Weight (kg)</Label>
              <Input
                id="weight"
                type="number"
                inputMode="decimal"
                min={2}
                max={300}
                step="0.1"
                placeholder="e.g. 62"
                className="h-11 rounded-xl bg-background/70"
                value={form.weightKg}
                onChange={(e) => update("weightKg", e.target.value)}
                aria-invalid={weightError ? true : undefined}
              />
              {weightError && (
                <p className="mt-1 text-xs text-crit">{weightError}</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/40 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Body Mass Index
            </p>
            {bmi != null ? (
              <div className="mt-1.5 flex items-center gap-2.5">
                <span className="tnum font-mono text-xl font-semibold text-foreground">
                  {bmi.toFixed(1)}
                </span>
                {bmiCat && (
                  <Badge className={cn("font-mono", BMI_BADGE_CLASS[bmiCat])}>
                    {BMI_CATEGORY_LABELS[bmiCat]}
                  </Badge>
                )}
              </div>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground">
                Enter height and weight to calculate your BMI.
              </p>
            )}
          </div>
        </SectionCard>

        {/* ---- 2. Pregnancy (female only) ---- */}
        {isFemale && (
          <SectionCard
            icon={Baby}
            title="Pregnancy Information"
            description="Shown because your profile lists gender as Female."
          >
            <div>
              <Label>Are you pregnant?</Label>
              <div
                className="flex flex-wrap gap-2"
                role="radiogroup"
                aria-label="Pregnancy status"
              >
                <ChoicePill
                  active={form.pregnant === "yes"}
                  onClick={() => update("pregnant", "yes")}
                >
                  Yes
                </ChoicePill>
                <ChoicePill
                  active={form.pregnant === "no"}
                  onClick={() => update("pregnant", "no")}
                >
                  No
                </ChoicePill>
              </div>
            </div>
            {form.pregnant === "yes" && (
              <div>
                <Label htmlFor="trimester">Trimester</Label>
                <Select
                  value={form.trimester}
                  onValueChange={(v) => update("trimester", v)}
                >
                  <SelectTrigger
                    id="trimester"
                    className="h-11 rounded-xl bg-background/70"
                  >
                    <SelectValue placeholder="Select trimester" />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIMESTER_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </SectionCard>
        )}

        {/* ---- 3. Lifestyle ---- */}
        <SectionCard
          icon={Dumbbell}
          title="Lifestyle"
          description="Health habits that inform your personalised recommendations."
        >
          <div>
            <Label htmlFor="smoking">Smoking</Label>
            <Select
              value={form.smokingStatus}
              onValueChange={(v) => update("smokingStatus", v)}
            >
              <SelectTrigger id="smoking" className="h-11 rounded-xl bg-background/70">
                <SelectValue placeholder="Select smoking status" />
              </SelectTrigger>
              <SelectContent>
                {SMOKING_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="alcohol">Alcohol</Label>
            <Select
              value={form.alcoholStatus}
              onValueChange={(v) => update("alcoholStatus", v)}
            >
              <SelectTrigger id="alcohol" className="h-11 rounded-xl bg-background/70">
                <SelectValue placeholder="Select alcohol intake" />
              </SelectTrigger>
              <SelectContent>
                {ALCOHOL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="exercise">Exercise Level</Label>
            <Select
              value={form.exerciseLevel}
              onValueChange={(v) => update("exerciseLevel", v)}
            >
              <SelectTrigger id="exercise" className="h-11 rounded-xl bg-background/70">
                <SelectValue placeholder="Select exercise level" />
              </SelectTrigger>
              <SelectContent>
                {EXERCISE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </SectionCard>

        {/* ---- 4. Existing Medical Conditions ---- */}
        <SectionCard
          icon={HeartPulse}
          title="Existing Medical Conditions"
          description="Select all that apply."
        >
          <MultiCheckGrid
            options={KNOWN_CONDITION_OPTIONS}
            value={form.knownConditions}
            onChange={(next) => update("knownConditions", next)}
          />
        </SectionCard>

        {/* ---- 5. Family History ---- */}
        <SectionCard
          icon={Users}
          title="Family History"
          description="Select all conditions present in your close family."
        >
          <MultiCheckGrid
            options={FAMILY_HISTORY_OPTIONS}
            value={form.familyHistory}
            onChange={(next) => update("familyHistory", next)}
          />
        </SectionCard>

        {/* ---- 6. Allergies ---- */}
        <SectionCard
          icon={ShieldAlert}
          title="Allergies"
          description="Medications, foods, or environmental triggers."
        >
          <div>
            <Label htmlFor="allergies">Allergies</Label>
            <Textarea
              id="allergies"
              rows={4}
              placeholder={"Penicillin\nPeanuts\nDust\nLatex"}
              className="rounded-xl bg-background/70"
              value={form.allergies}
              onChange={(e) => update("allergies", e.target.value)}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              List one allergy per line.
            </p>
          </div>
        </SectionCard>

        {/* ---- 7. Current Medications ---- */}
        <SectionCard
          icon={Pill}
          title="Current Medications"
          description="Everything you take regularly — include dosage and frequency."
        >
          {form.medications.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No medications added yet.
            </p>
          ) : (
            <div className="space-y-3">
              {form.medications.map((med, i) => (
                <div
                  key={i}
                  className="grid items-start gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
                >
                  <Input
                    placeholder="Medicine name"
                    aria-label={`Medicine name ${i + 1}`}
                    className="h-10 rounded-xl bg-background/70"
                    value={med.name}
                    onChange={(e) => updateMed(i, "name", e.target.value)}
                  />
                  <Input
                    placeholder="Dosage"
                    aria-label={`Dosage ${i + 1}`}
                    className="h-10 rounded-xl bg-background/70"
                    value={med.dosage}
                    onChange={(e) => updateMed(i, "dosage", e.target.value)}
                  />
                  <Input
                    placeholder="Frequency"
                    aria-label={`Frequency ${i + 1}`}
                    className="h-10 rounded-xl bg-background/70"
                    value={med.frequency}
                    onChange={(e) => updateMed(i, "frequency", e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-10 cursor-pointer rounded-xl"
                    aria-label={`Remove medicine ${i + 1}`}
                    onClick={() => removeMed(i)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer rounded-xl"
            onClick={addMed}
          >
            <Plus className="size-4" />
            Add another medicine
          </Button>
        </SectionCard>

        {/* ---- 8. Emergency Contact ---- */}
        <SectionCard
          icon={Phone}
          title="Emergency Contact"
          description="Who should we reach in an emergency?"
          className="lg:col-span-2"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="emergency-name">Name</Label>
              <Input
                id="emergency-name"
                autoComplete="name"
                placeholder="e.g. Rajesh Sharma"
                className="h-11 rounded-xl bg-background/70"
                value={form.emergencyName}
                onChange={(e) => update("emergencyName", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="emergency-relationship">Relationship</Label>
              <Input
                id="emergency-relationship"
                placeholder="e.g. Father"
                className="h-11 rounded-xl bg-background/70"
                value={form.emergencyRelationship}
                onChange={(e) => update("emergencyRelationship", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="emergency-phone">Phone Number</Label>
              <Input
                id="emergency-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="e.g. +91 98765 43210"
                className="h-11 rounded-xl bg-background/70"
                value={form.emergencyPhone}
                onChange={(e) => update("emergencyPhone", e.target.value)}
                aria-invalid={phoneError ? true : undefined}
              />
              {phoneError && <p className="mt-1 text-xs text-crit">{phoneError}</p>}
            </div>
          </div>
        </SectionCard>
      </div>
    </motion.div>
  );
}
