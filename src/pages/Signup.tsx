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
import { useAuth } from "@/hooks/use-auth";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

const signupSchema = z
  .object({
    fullName: z
      .string()
      .min(2, "Please enter your full name")
      .max(80, "Name is too long"),
    email: z
      .string()
      .min(1, "Email is required")
      .email("Enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[a-zA-Z]/, "Password must contain at least one letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match",
  });

type SignupValues = z.infer<typeof signupSchema>;

export default function Signup() {
  const { isLoading, isAuthenticated, signUp } = useAuth();
  const navigate = useNavigate();
  const [confirmationSent, setConfirmationSent] = useState(false);

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isLoading, isAuthenticated, navigate]);

  const onSubmit = async (values: SignupValues) => {
    try {
      const { needsEmailConfirmation } = await signUp({
        fullName: values.fullName,
        email: values.email,
        password: values.password,
      });
      if (needsEmailConfirmation) {
        setConfirmationSent(true);
        toast.success("Account created!", {
          description: "Check your inbox to confirm your email address.",
        });
        return;
      }
      toast.success("Welcome to ArogyaOS!");
      navigate("/onboarding", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to sign up.");
    }
  };

  if (confirmationSent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="We sent you a confirmation link to finish creating your account."
      >
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-ok/15 text-ok">
            <CheckCircle2 className="size-7" />
          </span>
          <p className="text-sm leading-6 text-muted-foreground">
            Once you confirm, you'll be able to sign in and start your health
            journey.
          </p>
          <Button
            asChild
            variant="outline"
            className="mt-2 w-full rounded-xl"
          >
            <Link to="/login">Go to sign in</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Your AI health memory, ready in under a minute."
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
                    disabled={form.formState.isSubmitting}
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
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    inputMode="email"
                    disabled={form.formState.isSubmitting}
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
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="8+ chars"
                      autoComplete="new-password"
                      disabled={form.formState.isSubmitting}
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
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Repeat password"
                      autoComplete="new-password"
                      disabled={form.formState.isSubmitting}
                      className="h-11 rounded-xl bg-background/70"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <Button
            type="submit"
            disabled={form.formState.isSubmitting}
            className="h-11 w-full rounded-xl text-[15px] font-medium"
          >
            {form.formState.isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Creating account…
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </form>
      </Form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          to="/login"
          className="font-medium text-foreground transition-colors hover:text-primary"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
