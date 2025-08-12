import { embedQueryText } from "@/lib/ai/utils/embedding";
import { createClient as supabaseClient } from "@supabase/supabase-js";

const supabase = supabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Contact = {
  name: string;
  type: string[];
  aliases?: string[];
  zoho_id: string;
  contact_group: string;
  address: string;
};

/**
 * Sync contacts from Zoho to vector db
 * @param contact - The contact to sync
 * @returns True if successful, false otherwise
 */
export async function syncContacts(contact: Contact) {
  try {
    // Normalize the name and aliases
    const name = contact.name.toLowerCase();
    const aliases = contact.aliases?.map(alias => alias.toLowerCase());
    const industry = contact.contact_group?.toLowerCase();
    const address = contact.address?.toLowerCase();

    // Create the alias line
    const aliasLine = aliases?.length ? `Aliases: ${aliases.join(", ")}` : null;

    // Create the input text
    const inputText = [
      `Contact: ${name}`,
      `Type: ${contact.type.join(", ")}`,
      `Industry: ${industry}`,
      `Address: ${address}`,
      aliasLine,
    ]
      .filter(Boolean)
      .join("\n");

    const embedding = await embedQueryText(inputText);

    await supabase.from("contacts").upsert(
      {
        name: name,
        aliases: aliases,
        embedding_input: inputText,
        embedding: embedding,
        type: contact.type,
        zoho_id: contact.zoho_id,
      },
      {
        onConflict: "zoho_id",
      }
    );

    return true;
  } catch (error) {
    console.error("🔍 Error:", error);
    throw error;
  }
}

/**
 * Find similar contacts by name, alias, or embedding
 * @param query - The query to search for
 * @param type - The type of contact to search for
 * @param queryEmbedding - The embedding of the query
 * @returns The similar contacts with source and data
 */
export async function findSimilarContacts(
  query: string,
  type: string,
  queryEmbedding: number[]
) {
  // Name match
  const { data: nameMatch, error: nameMatchError } = await supabase
    .from("contacts")
    .select("*")
    .ilike("name", `%${query}%`)
    .contains("type", [type])
    .limit(1);
  if (nameMatchError) throw nameMatchError;

  if (nameMatch.length > 0) return { source: "name", data: nameMatch };

  // Alias match
  const { data: aliasMatch, error: aliasMatchError } = await supabase
    .from("contacts")
    .select("*")
    .contains("aliases", [query])
    .contains("type", [type])
    .limit(1);
  if (aliasMatchError) throw aliasMatchError;

  if (aliasMatch.length > 0) return { source: "alias", data: aliasMatch };

  // Similarity search
  const { data, error } = await supabase.rpc("get_contact_by_type", {
    type_input: type,
    query: query,
    query_embedding: queryEmbedding,
    match_threshold: 0.6,
    match_count: 1,
  });
  if (error) throw error;
  if (data.length > 0) return { source: "embedding", data };
  return null;
}
