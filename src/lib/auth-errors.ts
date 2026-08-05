/**
 * Maps Supabase auth errors (and network failures) to friendly,
 * user-presentable messages.
 */
export function getAuthErrorMessage(error: unknown): string {
  const raw =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "Something went wrong");

  const code = (error as { code?: string } | null)?.code ?? "";
  const lower = raw.toLowerCase();

  // Network-level failures
  if (
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("load failed") ||
    code === "ERR_NETWORK"
  ) {
    return "Network error. Check your connection and try again.";
  }

  // Credentials
  if (
    lower.includes("invalid login credentials") ||
    lower.includes("invalid credentials") ||
    code === "invalid_credentials"
  ) {
    return "Incorrect email or password.";
  }

  // Account existence
  if (
    lower.includes("user already registered") ||
    lower.includes("already exists") ||
    code === "user_already_exists"
  ) {
    return "An account with this email already exists. Try signing in instead.";
  }

  // Email confirmation
  if (
    lower.includes("email not confirmed") ||
    code === "email_not_confirmed"
  ) {
    return "Please confirm your email address before signing in.";
  }

  // Weak password
  if (
    lower.includes("weak password") ||
    lower.includes("at least 6 characters") ||
    lower.includes("password should be") ||
    code === "weak_password"
  ) {
    return "Password must be at least 8 characters long.";
  }

  // Rate limits
  if (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    code === "over_email_send_rate_limit"
  ) {
    return "Too many attempts. Please wait a minute and try again.";
  }

  // Invalid email
  if (
    lower.includes("invalid email") ||
    lower.includes("not a valid email") ||
    lower.includes("email address is invalid")
  ) {
    return "That email address doesn't look right. Please check it.";
  }

  // Recovery link
  if (
    lower.includes("invalid link") ||
    lower.includes("expired") ||
    lower.includes("recovery")
  ) {
    return "This password reset link is invalid or has expired. Request a new one.";
  }

  // Unknown — keep the raw message but cap length
  return raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
}
