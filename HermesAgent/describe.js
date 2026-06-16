// Etsy listing copy generator. Works "in tandem with Claude": it grounds the
// description in REAL Printify facts (the blueprint's material, the print
// provider's country) and then asks Claude to write warm, specific copy that
// includes the material, the country of manufacture, and a brief design-
// inspiration overview. Without ANTHROPIC_API_KEY it falls back to a clean
// template built from the same real facts — so it never invents specs.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-8";

// ISO-3166 alpha-2 → friendly name, for the print providers Printify actually uses.
const COUNTRY = {
  US: "the United States", GB: "the United Kingdom", CA: "Canada", AU: "Australia",
  DE: "Germany", CZ: "the Czech Republic", CN: "China", LV: "Latvia", IT: "Italy",
  ES: "Spain", FR: "France", NL: "the Netherlands", PL: "Poland", MX: "Mexico",
  LT: "Lithuania", SE: "Sweden",
};
export const countryName = (code) => (code ? (COUNTRY[code] || code) : "imported");

const stripHtml = (s = "") => s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\.:/g, ". ").replace(/\s+/g, " ").replace(/\s+([.,;])/g, "$1").trim();

// Pull the sentence that best describes what the product is made of. Score each
// sentence — an explicit "100% cotton fabric / 180gsm" line beats a generic
// "heavy cotton tee" mention — and pick the strongest, else the lead sentence.
const MATERIAL_WORDS = /\b(cotton|polyester|poly|fleece|ceramic|tri-?blend|blend|canvas|vinyl|stainless|wool|linen|jersey|airlume|combed|ring-?spun)\b/i;
function extractMaterial(desc) {
  const sentences = desc.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);
  let best = null, bestScore = 0;
  for (const s of sentences) {
    let score = 0;
    if (/\d+\s*%/.test(s)) score += 3;             // "100% cotton"
    if (/\b(fabric|gsm|g\/m|oz\.?\/?yd|grams?)\b/i.test(s)) score += 2;
    if (MATERIAL_WORDS.test(s)) score += 1;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (best) return best;
  return sentences[0] || "Premium print-on-demand material";
}

/**
 * Generate the listing description.
 * @param {{facts: object, productTitle: string, designTitle?: string, designPrompt?: string}} args
 *   facts comes from printifyListingFacts() in printify.js
 * @returns {Promise<{description, material, country, source}>}
 */
export async function generateListingCopy({ facts = {}, productTitle, designTitle, designPrompt }) {
  const material = facts.material || extractMaterial(facts.blueprintDescription || "");
  const country = facts.country || "imported";
  const title = productTitle || facts.productType || designTitle || "Custom design";

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic();
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 700,
        system:
          "You are an Etsy copywriter for a print-on-demand shop. Write warm, specific, " +
          "conversion-focused product descriptions. Use ONLY the material and country facts " +
          "you are given — never invent specs or a different manufacturing location. " +
          "Plain text only (no markdown, no emoji in headings), about 130-160 words.",
        messages: [{
          role: "user",
          content:
            `Write an Etsy listing description for this print-on-demand product.\n\n` +
            `Product: ${facts.productType || title}${facts.brand ? ` by ${facts.brand}` : ""}.\n` +
            `Design name: ${designTitle || title}.\n` +
            (designPrompt ? `Design prompt / notes: ${designPrompt}\n` : "") +
            `\nUse these EXACT facts (do not alter them):\n` +
            `- Material: ${material}\n` +
            `- Country of manufacture: ${country}\n\n` +
            `Structure it as:\n` +
            `1) A one-line hook.\n` +
            `2) "Design inspiration:" 2-3 sentences on the design's vibe and what inspired it.\n` +
            `3) "Material:" restate the material fact.\n` +
            `4) "Made in:" the country of manufacture.\n` +
            `Keep it skimmable and friendly.`,
        }],
      });
      const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (text) return { description: text, material, country, source: "claude" };
    } catch {
      // fall through to template
    }
  }

  // Template fallback — still grounded in the real material + country.
  const inspo = designTitle
    ? `Inspired by ${designTitle.toLowerCase()}, this piece brings an original, eye-catching look you won't find on the shelf.`
    : `An original, eye-catching design made to stand out.`;
  const description = [
    `${title} — original art, printed to order.`,
    ``,
    `Design inspiration: ${inspo}`,
    ``,
    `Material: ${material}`,
    `Made in: ${country}`,
  ].join("\n");
  return { description, material, country, source: "template" };
}
