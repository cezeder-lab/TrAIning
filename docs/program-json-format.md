# Format JSON du programme

Fichier produit par **Programme → Exporter JSON** et lu par **Importer JSON**. L'import crée un nouveau programme et l'active ; le programme courant est archivé (réactivable dans Paramètres), l'historique des séances n'est jamais modifié.

```jsonc
{
  "format": "training-program",   // obligatoire
  "version": 1,                   // obligatoire
  "exportedAt": "2026-09-27T17:00:00.000Z",
  "program": {
    "name": "Push / Pull / Legs",
    "comment": "- Pauses courtes.\n- …",
    "templates": [
      {
        "name": "Pull",
        "comment": null,
        "slots": [
          {
            "block": "work",              // warmup | work | finisher | cooldown (défaut : work)
            "blockLabel": null,           // sous-titre de bloc, ex. « Gainage / posture »
            "label": "Tirage horizontal", // nom du slot quand il y a des alternatives
            "sets": 3,
            "targetMin": 8,
            "targetMax": 10,
            "targetUnit": "reps",         // reps | s | m | min
            "perSide": false,
            "loadKg": null,
            "loadNextKg": null,           // palier visé (« 22 → 24 kg »)
            "loadNote": null,
            "rirMin": null,
            "rirMax": null,
            "restS": null,
            "comment": "Maintien, pas à l'échec.",
            "isOptional": false,
            "enabledByDefault": true,
            "options": [                  // au moins une ; la première est le choix par défaut
              { "exercise": "Rowing haltère", "loadKg": 26 },
              { "exercise": "Tirage horizontal poulie basse (prise V)" }
            ]
          }
        ]
      }
    ]
  },
  "exercises": [
    {
      "name": "Rowing haltère",
      "kind": "weight",                  // weight | bodyweight | cardio | isometric
      "equipment": "Haltère",
      "techniqueNotes": null,
      "muscles": [{ "id": "upper_back", "role": "primary" }, { "id": "biceps", "role": "secondary" }]
    }
  ]
}
```

## Règles d'import

- Les exercices sont reliés **par nom** (casse et accents ignorés). Un exercice qui existe déjà est réutilisé tel quel ; sinon il est créé à partir de la liste `exercises` (ou, s'il n'y figure pas, comme exercice « Poids » sans muscle).
- Les champs d'une alternative (`sets`, `targetMin`, `targetMax`, `loadKg`, `loadNextKg`, `note`) surchargent ceux du slot ; absents ou `null`, ce sont les valeurs du slot qui s'appliquent.
- Identifiants des groupes musculaires : `chest_upper`, `chest`, `delt_front`, `delt_side`, `delt_rear`, `lats`, `upper_back`, `biceps`, `triceps`, `forearms`, `abs`, `obliques`, `core_deep`, `lower_back`, `glutes`, `quads`, `hamstrings`, `adductors`, `calves`, `mobility`. Un identifiant inconnu est ignoré.
- Un fichier invalide est refusé en entier, avec un message indiquant le premier problème ; rien n'est écrit en base.
