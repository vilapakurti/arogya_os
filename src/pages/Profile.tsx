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
import { Loader2, LogOut } from "lucide-react";
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

const profileSchema = z.object({
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

type ProfileValues = z.infer<typeof profileSchema>;

export default function Profile() {
  const { user, profile, updateProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullName: "",
      age: "",
      gender: "",
      preferred_language: "en",
    },
  });

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

  const onSubmit = async (values: ProfileValues) => {
    try {
      await updateProfile({
        full_name: values.fullName,
        age: values.age === "" ? null : Number(values.age),
        gender: values.gender,
        preferred_language: values.preferred_language,
      });
      toast.success("Profile updated");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Unable to update your profile.",
      );
    }
  };

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out");
    navigate("/login", { replace: true });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <p className="font-mono text-[12px] text-muted-foreground">
        <span className="text-primary">$</span> arogya profile
      </p>
      <h1 className="mt-3 font-mono text-3xl font-semibold tracking-tight text-foreground">
        Your profile
      </h1>

      <div className="glass-card mt-6 rounded-3xl p-7 sm:p-8">
        <div className="mb-6 rounded-xl border border-border/60 bg-background/60 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            account email
          </p>
          <p className="mt-1 font-mono text-sm text-foreground">
            {user?.email}
          </p>
        </div>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
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
            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
              <Button
                type="submit"
                disabled={form.formState.isSubmitting}
                className="h-11 flex-1 rounded-xl text-[15px] font-medium"
              >
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 cursor-pointer rounded-xl"
                onClick={handleSignOut}
              >
                <LogOut className="size-4" />
                Sign out
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
