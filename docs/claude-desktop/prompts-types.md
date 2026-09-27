# Prompts types pour Claude Desktop

Deux façons de les utiliser :

- **Menu de Claude Desktop** : bouton **+** (ou « / ») → *TrAIning* → choisir le prompt. Les dates sont remplies automatiquement.
- **Copier-coller** : copier un bloc ci-dessous dans une conversation, remplacer les dates si besoin.

Avant tout, vérifiez que Claude voit bien l'application : demandez « Quel est mon programme ? » ; il doit appeler l'outil `get_program`.

## Analyse de la semaine

Bilan entraînement + récupération + nutrition + poids de la semaine, avec 3 actions au plus.

```text
Fais l'analyse de ma semaine du AAAA-MM-JJ au AAAA-MM-JJ.

1. Lis mon profil (get_user_profile) et mon programme (get_program).
2. Récupère mes séances (get_sessions, détail « sets »), mon cardio (get_cardio_sessions), mon poids (get_body_metrics) et ma nutrition (get_nutrition_summary) sur cette période ; pour 2 ou 3 exercices clés, compare avec leur historique (get_exercise_history).

Réponds de façon concise, avec ces rubriques :
- Réalisé vs prévu : séances faites, sautées, exercices optionnels (non faits = normal).
- Progression : charges et répétitions sur les exercices clés. Sépare ce qui est mesuré, estimé (1RM estimé) et probable.
- Récupération : fatigue, courbatures, douleurs. En cas de douleur, propose une adaptation concrète (alternative du programme, amplitude, charge).
- Nutrition : moyennes des jours renseignés vs objectifs, protéines, jours non renseignés, part d'estimations.
- Poids : seulement si get_body_metrics donne une tendance « ok » ; sinon dis qu'il n'y a pas assez de pesées.
- Pour la semaine prochaine : 3 actions maximum.
Ne tire pas de conclusion forte si les données sont insuffisantes : dis ce qui manque.
```

## Saisir un repas

Saisie guidée d’un repas décrit en langage naturel, avec récapitulatif et confirmation avant écriture.

```text
Je vais te décrire ce que j'ai mangé au repas « Déjeuner » (aujourd'hui sauf si je précise une date).

Pour chaque aliment :
1. Cherche-le avec search_food (choisis l'état cru/cuit qui correspond à ce que j'ai pesé).
2. Si la quantité est floue, pose une question courte ou propose une estimation chiffrée explicite.
3. N'estime des valeurs nutritionnelles qu'en dernier recours, avec estimated=true, et dis-le.

Puis montre un tableau récapitulatif : aliment, quantité, kcal, protéines, glucides, lipides, source. Attends mon « OK » avant d'appeler add_food_entry (user_confirmed=true). Ensuite donne le total du jour et ce qu'il reste par rapport à mon objectif.

Voici mon repas :
```

## Bilan nutrition

Bilan nutritionnel des derniers jours vs objectifs, avec 2-3 suggestions concrètes.

```text
Fais le bilan de ma nutrition des 7 derniers jours (du AAAA-MM-JJ au AAAA-MM-JJ).

Utilise get_user_profile puis get_nutrition_summary ; ouvre get_day_log pour 1 ou 2 jours atypiques si utile.
- Moyennes des jours renseignés vs objectifs (en tenant compte du type de jour : repos, musculation, cardio).
- Protéines : régularité et répartition.
- Jours non renseignés et part d'entrées estimées (fiabilité du bilan).
- Si get_body_metrics donne une tendance de poids exploitable, mets-la en regard des apports ; sinon ne conclus pas.
Termine par 2 ou 3 suggestions concrètes, basées sur des aliments que je mange déjà. Reste concis et factuel.
```

## Autres idées de questions

- « Qu'est-ce que je dois manger ce soir pour atteindre mes protéines ? »
- « Mon épaule gauche me gêne au développé : quelles alternatives de mon programme ? »
- « Compare mes 4 dernières séances Push. »
- « J'ai pesé 80,4 kg ce matin. » (Claude enregistre la pesée)
- « Ajoute une note à ma séance d'hier : fatigue 7, genou droit 2/10 en fin de squat. »
