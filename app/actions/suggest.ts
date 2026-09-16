"use server";

import { z } from "zod";
import { SITE } from "@/lib/site";

const schema = z.object({
  title: z.string().trim().min(4, "Give it a short, clear name.").max(120),
  description: z
    .string()
    .trim()
    .min(15, "Tell us a little more about what it should do.")
    .max(2000),
  category: z.string().trim().max(40).optional().default(""),
  email: z
    .union([z.string().trim().email("That email looks off."), z.literal("")])
    .optional()
    .default(""),
  // Honeypot — real users never fill this hidden field.
  website: z.string().max(0).optional().default(""),
});

export interface SuggestState {
  status: "idle" | "success" | "error";
  message?: string;
  url?: string;
  fallbackUrl?: string;
  fieldErrors?: Record<string, string>;
}

const REPO = process.env.GITHUB_REPO || SITE.repo;

export async function suggestTool(
  _prev: SuggestState,
  formData: FormData,
): Promise<SuggestState> {
  const parsed = schema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    category: formData.get("category"),
    email: formData.get("email"),
    website: formData.get("website"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (key === "website") {
        // Honeypot tripped — pretend success, drop silently.
        return { status: "success", message: "Thanks for the suggestion!" };
      }
      fieldErrors[key] = issue.message;
    }
    return { status: "error", fieldErrors, message: "Please fix the fields above." };
  }

  const { title, description, category, email } = parsed.data;

  const body = [
    description,
    "",
    category ? `**Suggested category:** ${category}` : "",
    email ? `**Contact:** ${email}` : "",
    "",
    "---",
    `_Submitted via the ${SITE.name} suggest-a-tool form._`,
  ]
    .filter(Boolean)
    .join("\n");

  const token = process.env.GITHUB_TOKEN;

  // Prefilled GitHub "new issue" URL — used as a no-token fallback and on failure.
  const fallbackUrl = `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(
    `[Tool] ${title}`,
  )}&labels=tool-suggestion&body=${encodeURIComponent(body)}`;

  if (!token) {
    return {
      status: "success",
      message: "Almost there — open the prefilled issue on GitHub to finish.",
      fallbackUrl,
    };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: `[Tool] ${title}`,
        body,
        labels: ["tool-suggestion"],
      }),
    });

    if (!res.ok) {
      return {
        status: "success",
        message: "Couldn’t file it automatically — open it on GitHub instead.",
        fallbackUrl,
      };
    }

    const issue = (await res.json()) as { html_url?: string };
    return {
      status: "success",
      message: "Suggestion filed — thank you!",
      url: issue.html_url,
    };
  } catch {
    return {
      status: "success",
      message: "Couldn’t reach GitHub — open the prefilled issue instead.",
      fallbackUrl,
    };
  }
}
