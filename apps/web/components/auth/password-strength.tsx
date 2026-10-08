import { cn } from "@/lib/utils";

/**
 * A gentle nudge, not a gate: the server only requires 10+ characters.
 * Length matters most (a short sentence beats "P@ssw0rd!"), variety helps.
 */
export function scorePassword(password: string): 0 | 1 | 2 | 3 {
  if (password.length < 10) return 0;
  let score = 1;
  if (password.length >= 14) score++;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (kinds >= 3 || (password.includes(" ") && password.length >= 16)) score++;
  return Math.min(score, 3) as 0 | 1 | 2 | 3;
}

const LABEL = ["Too short", "Okay", "Good", "Strong"] as const;
const TONE = ["bg-destructive", "bg-warning", "bg-success", "bg-success"] as const;

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const score = scorePassword(password);
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="grid flex-1 grid-cols-3 gap-1">
        {[1, 2, 3].map((segment) => (
          <span
            key={segment}
            className={cn("h-1 rounded-full transition-colors duration-200", score >= segment ? TONE[score] : "bg-muted", score === 0 && segment === 1 && "bg-destructive")}
          />
        ))}
      </div>
      <span className="w-16 text-right text-xs text-muted-foreground">{LABEL[score]}</span>
    </div>
  );
}
