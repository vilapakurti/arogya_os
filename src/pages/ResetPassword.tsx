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
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

const resetSchema = z
  .object({
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

type ResetValues = z.infer<typeof resetSchema>;

export default function ResetPassword() {
  const { isLoading, isRecovery, session, updatePassword, signOut } = useAuth();
  const navigate = useNavigate();

  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const hasRecoverySession = Boolean(isRecovery && session?.user);

  const onSubmit = async (values: ResetValues) => {
    try {
      await updatePassword(values.password);
      await signOut();
      toast.success("Password updated", {
        description: "Please sign in with your new password.",
      });
      navigate("/login", { replace: true });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Unable to reset your password.",
      );
    }
  };

  return (
    <AuthShell
      title="Set a new password"
      subtitle={
        hasRecoverySession
          ? "Choose a strong password for your ArogyaOS account."
          : "This link is invalid or has expired."
      }
    >
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : !hasRecoverySession ? (
        <div className="flex flex-col gap-4 py-2 text-center">
          <p className="text-sm leading-6 text-muted-foreground">
            Password reset links expire after a short time. Request a fresh
            one to continue.
          </p>
          <Button asChild className="w-full rounded-xl">
            <Link to="/forgot-password">Request a new link</Link>
          </Button>
          <Button asChild variant="outline" className="w-full rounded-xl">
            <Link to="/login">Back to sign in</Link>
          </Button>
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="8+ characters, letters & numbers"
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
                  <FormLabel>Confirm new password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Repeat new password"
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
            <Button
              type="submit"
              disabled={form.formState.isSubmitting}
              className="h-11 w-full rounded-xl text-[15px] font-medium"
            >
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Updating password…
                </>
              ) : (
                "Update password"
              )}
            </Button>
          </form>
        </Form>
      )}
    </AuthShell>
  );
}
