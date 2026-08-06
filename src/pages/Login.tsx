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
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function Login() {
  const { isLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo =
    searchParams.get("redirectTo")?.startsWith("/") ? searchParams.get("redirectTo")! : "/dashboard";

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  // Auto-redirect already-authenticated users away from the login page.
  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate(redirectTo, { replace: true });
  }, [isLoading, isAuthenticated, navigate, redirectTo]);

  const onSubmit = async (values: LoginValues) => {
    try {
      await signIn(values);
      toast.success("Welcome back to ArogyaOS");
      navigate(redirectTo, { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to sign in.");
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to continue your health journey."
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
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel>Password</FormLabel>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-foreground/70 transition-colors hover:text-primary"
                  >
                    Forgot password?
                  </Link>
                </div>
                <FormControl>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    autoComplete="current-password"
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
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </Form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to ArogyaOS?{" "}
        <Link
          to="/signup"
          className="font-medium text-foreground transition-colors hover:text-primary"
        >
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
