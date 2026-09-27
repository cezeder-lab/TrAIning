/** Prompts types pour Claude Desktop : exposés par le serveur MCP et affichés dans l'application. */

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  /** Texte envoyé à Claude ; `{from}`, `{to}`, `{repas}`, `{jours}` sont remplacés. */
  template: string;
}

/** Prompts types : exposés par le serveur MCP et recopiés dans docs/claude-desktop/prompts-types.md. */
export const PROMPTS: PromptDef[] = [
  {
    name: 'analyse_hebdo',
    title: 'Analyse de la semaine',
    description: "Bilan entraînement + récupération + nutrition + poids de la semaine, avec 3 actions au plus.",
    template: `Fais l'analyse de ma semaine du {from} au {to}.

1. Lis mon profil (get_user_profile) et mon programme (get_program).
2. Récupère mes séances (get_sessions, détail « sets »), mon cardio (get_cardio_sessions), mon poids (get_body_metrics) et ma nutrition (get_nutrition_summary) sur cette période ; pour 2 ou 3 exercices clés, compare avec leur historique (get_exercise_history).

Réponds de façon concise, avec ces rubriques :
- Réalisé vs prévu : séances faites, sautées, exercices optionnels (non faits = normal).
- Progression : charges et répétitions sur les exercices clés. Sépare ce qui est mesuré, estimé (1RM estimé) et probable.
- Récupération : fatigue, courbatures, douleurs. En cas de douleur, propose une adaptation concrète (alternative du programme, amplitude, charge).
- Nutrition : moyennes des jours renseignés vs objectifs, protéines, jours non renseignés, part d'estimations.
- Poids : seulement si get_body_metrics donne une tendance « ok » ; sinon dis qu'il n'y a pas assez de pesées.
- Pour la semaine prochaine : 3 actions maximum.
Ne tire pas de conclusion forte si les données sont insuffisantes : dis ce qui manque.`,
  },
  {
    name: 'saisie_repas',
    title: 'Saisir un repas',
    description: 'Saisie guidée d’un repas décrit en langage naturel, avec récapitulatif et confirmation avant écriture.',
    template: `Je vais te décrire ce que j'ai mangé au repas « {repas} » (aujourd'hui sauf si je précise une date).

Pour chaque aliment :
1. Cherche-le avec search_food (choisis l'état cru/cuit qui correspond à ce que j'ai pesé).
2. Si la quantité est floue, pose une question courte ou propose une estimation chiffrée explicite.
3. N'estime des valeurs nutritionnelles qu'en dernier recours, avec estimated=true, et dis-le.

Puis montre un tableau récapitulatif : aliment, quantité, kcal, protéines, glucides, lipides, source. Attends mon « OK » avant d'appeler add_food_entry (user_confirmed=true). Ensuite donne le total du jour et ce qu'il reste par rapport à mon objectif.

Voici mon repas :`,
  },
  {
    name: 'bilan_nutrition',
    title: 'Bilan nutrition',
    description: 'Bilan nutritionnel des derniers jours vs objectifs, avec 2-3 suggestions concrètes.',
    template: `Fais le bilan de ma nutrition des {jours} derniers jours (du {from} au {to}).

Utilise get_user_profile puis get_nutrition_summary ; ouvre get_day_log pour 1 ou 2 jours atypiques si utile.
- Moyennes des jours renseignés vs objectifs (en tenant compte du type de jour : repos, musculation, cardio).
- Protéines : régularité et répartition.
- Jours non renseignés et part d'entrées estimées (fiabilité du bilan).
- Si get_body_metrics donne une tendance de poids exploitable, mets-la en regard des apports ; sinon ne conclus pas.
Termine par 2 ou 3 suggestions concrètes, basées sur des aliments que je mange déjà. Reste concis et factuel.`,
  },
];

export function renderPrompt(def: PromptDef, vars: Record<string, string>): string {
  return def.template.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? `{${k}}`);
}
