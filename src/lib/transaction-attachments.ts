import { SupabaseClient } from "@supabase/supabase-js";

type AttachmentInput = { files: File[]; recordId: string; type: "delivery" | "return" };

function safeFileName(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-|-$/g, ""); }

export async function uploadTransactionPhotos(supabase: SupabaseClient, { files, recordId, type }: AttachmentInput) {
  if (!files.length) return { error: null, count: 0 };
  if (files.some((file) => file.size > 10 * 1024 * 1024)) return { error: "Cada foto deve ter no máximo 10 MB.", count: 0 };
  const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (files.some((file) => !allowedMimeTypes.has(file.type))) return { error: "As fotos devem estar em formato JPG, PNG ou WEBP.", count: 0 };
  const { data: profile, error: profileError } = await supabase.from("profiles").select("organization_id").single();
  if (profileError) return { error: profileError.message, count: 0 };
  if (!profile?.organization_id) return { error: "Não foi possível identificar a organização.", count: 0 };
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) return { error: authError.message, count: 0 };
  const uploadedPaths: string[] = [];
  const attachments: Array<Record<string, string | null>> = [];
  for (const file of files) {
    const path = `${profile.organization_id}/${type}/${recordId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage.from("transaction-photos").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      if (uploadedPaths.length) await supabase.storage.from("transaction-photos").remove(uploadedPaths);
      return { error: uploadError.message, count: 0 };
    }
    uploadedPaths.push(path);
    attachments.push({ organization_id: profile.organization_id, delivery_id: type === "delivery" ? recordId : null, return_id: type === "return" ? recordId : null, attachment_type: type, file_path: path, file_name: file.name, mime_type: file.type, created_by: auth.user?.id ?? null });
  }
  const { error: insertError } = await supabase.from("transaction_attachments").insert(attachments);
  if (insertError) { await supabase.storage.from("transaction-photos").remove(uploadedPaths); return { error: insertError.message, count: 0 }; }
  return { error: null, count: attachments.length };
}
