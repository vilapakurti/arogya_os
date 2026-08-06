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
import { Loader2, MailCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

const forgotSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
});

type ForgotValues = z.infer<typeof forgotSchema>;

export default function ForgotPassword() {
  const { isLoading, isAuthenticated, sendPasswordReset } = useAuth();
  const navigate = useNavigate();
  const [sent, setSent] = useState(false);

  const form = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isLoading, isAuthenticated, navigate]);

  const onSubmit = async (values: ForgotValues) => {
    try {
      await sendPasswordReset(values.email);
      setSent(true);
      toast.success("Reset link sent", {
        description: "Check your inbox for instructions to reset your password.",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to send reset link.");
    }
  };

  if (sent) {
    return (
      <AuthShell
        title="Check your inbox"
        subtitle="We sent a password reset link to your email."
      >
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-ok/15 text-ok">
            <MailCheck className="size-7" />
          </span>
          <p className="text-sm leading-6 text-muted-foreground">
            The link expires shortly, so open it soon. Didn't get it? Check
            spam, or request another one.
          </p>
          <Button
            asChild
            variant="outline"
            className="mt-2 w-full rounded-xl"
          >
            <Link to="/login">Back to sign in</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a reset link."
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
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
          <Button
            type="submit"
            disabled={form.formState.isSubmitting}
            className="h-11 w-full rounded-xl text-[15px] font-medium"
          >
            {form.formState.isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Sending link…
              </>
            ) : (
              "Send reset link"
            )}
          </Button>
        </form>
      </Form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Remembered it?{" "}
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
