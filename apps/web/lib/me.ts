export type Me = {
  user: { id: string; name: string; email: string; image?: string | null; avatarHue?: number | null; twoFactorEnabled?: boolean | null };
  session: { id: string; expiresAt: string; activeOrganizationId: string };
  personalOrgId: string;
  organizations: Array<{ id: string; name: string; slug: string; role: string }>;
};
