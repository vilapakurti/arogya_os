import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi (हिन्दी)" },
  { value: "ta", label: "Tamil (தமிழ்)" },
  { value: "mr", label: "Marathi (मराठी)" },
  { value: "bn", label: "Bengali (বাংলা)" },
  { value: "te", label: "Telugu (తెలుగు)" },
];

const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const AGE_RE = /^\d+$/;

const onboardingSchema = z.object({
  fullName: z
    .string()
    .min(2, "Please enter your full name")
    .max(80, "Name is too long"),
  age: z
    .string()
    .refine(
      (v) => {
        if (v === "") return true;
        return AGE_RE.test(v) && Number(v) >= 0 && Number(v) <= 130;
      },
      { message: "Enter a valid age (0–130)" },
    ),
  gender: z.string().min(1, "Please choose an option"),
  preferred_language: z.string().min(1, "Please choose a language"),
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

export default function Onboarding() {
  const { isLoading, isAuthenticated, profile, updateProfile } = useAuth();
  const navigate = useNavigate();

  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      fullName: "",
      age: "",
      gender: "",
      preferred_language: "en",
    },
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/login", { replace: true });
    }
  }, [isLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (profile) {
      form.reset({
        fullName: profile.full_name ?? "",
        age: profile.age != null ? String(profile.age) : "",
        gender: profile.gender ?? "",
        preferred_language: profile.preferred_language ?? "en",
      });
    }
  }, [profile, form]);

  const onSubmit = async (values: OnboardingValues) => {
    try {
      await updateProfile({
        full_name: values.fullName,
        age: values.age === "" ? null : Number(values.age),
        gender: values.gender,
        preferred_language: values.preferred_language,
      });
      toast.success("Profile saved", {
        description: "Your health memory is ready to go.",
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Unable to save your profile.",
      );
    }
  };

  return (
    <AuthShell
      title="Make it yours"
      subtitle="A few details help your AI health memory personalize every insight."
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="fullName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full name</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    placeholder="Priya Sharma"
                    autoComplete="name"
                    className="h-11 rounded-xl bg-background/70"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="age"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Age</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={130}
                      placeholder="e.g. 32"
                      className="h-11 rounded-xl bg-background/70"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="gender"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Gender</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger className="h-11 rounded-xl bg-background/70">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {GENDERS.map((g) => (
                        <SelectItem key={g.value} value={g.value}>
                          {g.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="preferred_language"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Preferred language</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger className="h-11 rounded-xl bg-background/70">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            disabled={form.formState.isSubmitting}
            className="h-11 w-full rounded-xl text-[15px] font-medium"
          >
            {form.formState.isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Continue to dashboard"
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full cursor-pointer rounded-xl font-mono text-[13px] text-muted-foreground"
            onClick={() => navigate("/dashboard", { replace: true })}
          >
            skip for now
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
