// (extrait allégé pour la lecture — le fichier réel gère aussi les erreurs)
const fs = require("fs");
const crypto = require("crypto");
const MAX_DIFF_CHARS = 12000;
const MAX_BODY_CHARS = 1000; // �� c'est CELUI-CI qui pilote la facture
const MAX_FERMETURES = 3; // �� plafond de fermetures par exécution
const MAX_RAISON_CHARS = 500; // �� borne la taille du commentaire posté
const MODELE = "gpt-4o-mini";
const [diffPath, issuesPath, outputPath] = process.argv.slice(2);
const apiKey = process.env.OPENAI_API_KEY;
// 1️⃣ Lecture + troncature
let diff = fs.readFileSync(diffPath, "utf-8");
if (diff.length > MAX_DIFF_CHARS) {
 diff = diff.slice(0, MAX_DIFF_CHARS) + "\n\n[… diff tronqué …]";
}
const issues = JSON.parse(fs.readFileSync(issuesPath, "utf-8"));
// 2️⃣ �� LA LISTE BLANCHE : les seuls numéros que le modèle aura le droit
// de désigner. Tout le reste sera jeté.
const numerosAutorises = new Set(issues.map((issue) => issue.number));
// 3️⃣ �� Les issues partent en JSON, PAS en texte décoré.
// JSON.stringify échappe les guillemets et les retours à la ligne :
// le texte d'un attaquant reste une valeur de chaîne, il ne peut plus
// fabriquer un faux enregistrement d'issue. Sérialiser, c'est échapper.
const listeIssues = JSON.stringify(
 issues.map((issue) => ({
 numero: issue.number,
 titre: String(issue.title || ""),
 description: String(issue.body || "(pas de description)").slice(0, 
MAX_BODY_CHARS),
 })),
 null,
 2
);
// 4️⃣ �� Un NONCE aléatoire dans le nom de la balise : l'attaquant écrit
// son issue AVANT l'exécution, il ne peut donc pas deviner ce nombre
// ni écrire la balise fermante pour « sortir » du bloc de données.
const nonce = crypto.randomUUID();

const baliseOuvrante = `<donnees_non_fiables_${nonce}>`;
const baliseFermante = `</donnees_non_fiables_${nonce}>`;
const contenuUtilisateur = `# Diff de la Pull Request mergée
\`\`\`diff
${diff}
\`\`\`
# Issues ouvertes à examiner (tableau JSON)
${baliseOuvrante}
${listeIssues}
${baliseFermante}`;
// 5️⃣ Appel API : réponse forcée en JSON.
// ⚠️ `await` ne s'utilise pas au niveau racine d'un fichier CommonJS
// (celui qui commence par `require`). On l'enferme dans une fonction
// `async` — sinon Node répond `ERR_AMBIGUOUS_MODULE_SYNTAX`.
async function interrogerIA() {
 const response = await fetch("https://api.openai.com/v1/chat/completions", {
 method: "POST",
 headers: { "Content-Type": "application/json", Authorization: `Bearer 
${apiKey}` },
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
 if (!response.ok) throw new Error(messageErreurHttp(response.status,
corpsBrut));
 const data = JSON.parse(corpsBrut); // 1er parse : l'enveloppe HTTP
 const contenu = data.choices?.[0]?.message?.content;
 if (typeof contenu !== "string" || contenu.trim() === "") {
 throw new Error("l'API a répondu 200 mais sans contenu exploitable.");
 }
 return JSON.parse(contenu); // 2e parse : le texte du
modèle
}
// 6️⃣ �� VALIDATION — on ne fait aucune confiance à la réponse
for (const proposition of proposees) {
 const valeur = proposition && proposition.issue;
 // On VÉRIFIE le type, on ne le CONVERTIT pas :
 // Number(true) → 1, Number("0xB") → 11, Number([14]) → 14.
 if (typeof valeur !== "number" || !Number.isInteger(valeur)) continue;

6 / 24
 if (!numerosAutorises.has(valeur)) continue; // hors
liste
 if (retenues.some((r) => r.issue === valeur)) continue; //
doublon
 retenues.push({
 issue: valeur,
 raison: String(proposition.raison || "…").slice(0, MAX_RAISON_CHARS),
 });
}
// 7️⃣ �� LE PLAFOND — au-delà de 3, on ne ferme RIEN du tout
if (retenues.length > MAX_FERMETURES) {
 console.log(`::warning::${retenues.length} fermetures proposées > plafond 
${MAX_FERMETURES}. Aucune issue fermée.`);
 retenues.length = 0;
}
