const fs = require("fs");

const MAX_BODY_CHARS = 2000;
const MODELE = "llama-3.1-8b-instant";

const [issuePath, outputPath] = process.argv.slice(2);
const apiKey = process.env.API_KEY;

if (!apiKey) {
  console.error("❌ API_KEY manquant.");
  process.exit(1);
}

const issue = JSON.parse(fs.readFileSync(issuePath, "utf-8"));

const titre = String(issue.title || "");
const description = String(issue.body || "(pas de description)").slice(0, MAX_BODY_CHARS);

const contenuUtilisateur = `# Nouvelle issue à trier

**Titre :** ${titre}

**Description :**
${description}`;

const consignesSysteme = `Tu es un assistant qui trie les issues GitHub.
Analyse le titre et la description ci-dessous et réponds UNIQUEMENT en JSON avec ce format :
{
  "categorie": "bug" | "amelioration" | "question" | "documentation",
  "priorite": "basse" | "moyenne" | "haute",
  "raison": "une phrase courte expliquant ton choix"
}`;

async function interrogerIA() {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODELE,
      messages: [
        { role: "system", content: consignesSysteme },
        { role: "user", content: contenuUtilisateur },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  const corpsBrut = await response.text();
  if (!response.ok) {
    throw new Error(`Erreur HTTP ${response.status} : ${corpsBrut}`);
  }

  const data = JSON.parse(corpsBrut);
  const contenu = data.choices?.[0]?.message?.content;

  if (typeof contenu !== "string" || contenu.trim() === "") {
    throw new Error("l'API a répondu 200 mais sans contenu exploitable.");
  }

  return JSON.parse(contenu);
}

async function main() {
  let resultat;
  try {
    resultat = await interrogerIA();
  } catch (err) {
    console.error("❌ Erreur lors de l'appel à l'IA :", err.message);
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        { categorie: "inconnue", priorite: "moyenne", raison: "Erreur d'analyse IA." },
        null,
        2
      )
    );
    process.exit(1);
  }

  const categoriesValides = ["bug", "amelioration", "question", "documentation"];
  const prioritesValides = ["basse", "moyenne", "haute"];

  const categorie = categoriesValides.includes(resultat.categorie) ? resultat.categorie : "inconnue";
  const priorite = prioritesValides.includes(resultat.priorite) ? resultat.priorite : "moyenne";
  const raison = String(resultat.raison || "…").slice(0, 500);

  fs.writeFileSync(outputPath, JSON.stringify({ categorie, priorite, raison }, null, 2));
  console.log("✅ Triage écrit dans", outputPath);
  console.log({ categorie, priorite, raison });
}

main();