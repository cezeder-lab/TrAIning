// Génère docs/claude-desktop/prompts-types.md à partir des prompts du serveur (source unique).
import { writeFileSync } from 'node:fs';
import { PROMPTS, renderPrompt } from '@training/core';

const vars = { from: 'AAAA-MM-JJ', to: 'AAAA-MM-JJ', repas: 'Déjeuner', jours: '7' };
const md = `# Prompts types pour Claude Desktop

Deux façons de les utiliser :

- **Menu de Claude Desktop** : bouton **+** (ou « / ») → *TrAIning* → choisir le prompt. Les dates sont remplies automatiquement.
- **Copier-coller** : copier un bloc ci-dessous dans une conversation, remplacer les dates si besoin.

Avant tout, vérifiez que Claude voit bien l'application : demandez « Quel est mon programme ? » ; il doit appeler l'outil \`get_program\`.

${PROMPTS.map(
  (p) => `## ${p.title}

${p.description}

\`\`\`text
${renderPrompt(p, vars)}
\`\`\`
`,
).join('\n')}
## Autres idées de questions

- « Qu'est-ce que je dois manger ce soir pour atteindre mes protéines ? »
- « Mon épaule gauche me gêne au développé : quelles alternatives de mon programme ? »
- « Compare mes 4 dernières séances Push. »
- « J'ai pesé 80,4 kg ce matin. » (Claude enregistre la pesée)
- « Ajoute une note à ma séance d'hier : fatigue 7, genou droit 2/10 en fin de squat. »
`;
writeFileSync(new URL('../../../docs/claude-desktop/prompts-types.md', import.meta.url), md);
console.log('docs/claude-desktop/prompts-types.md généré');
