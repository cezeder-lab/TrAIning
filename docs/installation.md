# Installer TrAIning sur Windows — guide pas à pas

Durée : environ 15 minutes. Aucune connaissance technique nécessaire : pas besoin d'installer Node, Rust ni aucun outil de développement.

---

## Étape 1 — Télécharger l'installeur

1. Ouvrez la page des versions du dépôt : **https://github.com/cezeder-lab/TrAIning/releases/tag/derniere-version** (connectez-vous à GitHub si la page demande une connexion : le dépôt est privé).
2. Dans la section **Assets**, cliquez sur le fichier **`TrAIning_0.1.0_x64-setup.exe`** (environ 100 Mo).
3. Le navigateur peut afficher « ce fichier n'est pas fréquemment téléchargé » : cliquez sur **⋯ → Conserver** (ou **Conserver quand même**).

> Si la page n'existe pas encore, la compilation est en cours sur GitHub (onglet **Actions** du dépôt, 15 à 25 minutes). Revenez un peu plus tard.

## Étape 2 — Installer l'application

1. Double-cliquez sur `TrAIning_0.1.0_x64-setup.exe`.
2. Windows affiche **« Windows a protégé votre ordinateur »** (l'application n'est pas signée par un éditeur payant) : cliquez sur **Informations complémentaires**, puis **Exécuter quand même**.
3. Suivez l'assistant (en français) : **Suivant → Installer → Terminer**. Aucun droit administrateur n'est demandé : l'application s'installe pour votre compte uniquement, dans `%LOCALAPPDATA%\TrAIning`.
4. Si Windows ne dispose pas de WebView2 (très rare sous Windows 10/11), l'installeur le télécharge automatiquement.

## Étape 3 — Premier lancement

1. Lancez **TrAIning** depuis le menu Démarrer.
2. Au premier lancement, l'application crée votre base (`%APPDATA%\fr.training.journal\training.db`), y insère votre programme **Push / Pull / Legs / Abdos** et installe la base alimentaire **Ciqual** : une notification « Base Ciqual installée » apparaît en bas à droite.
   - Si la notification n'apparaît pas : **Nutrition → Aliments & recettes → Base Ciqual → Télécharger la dernière version**.
3. Allez dans **Paramètres** :
   - **Profil** : remplissez vos objectifs, vos priorités musculaires, vos contraintes physiques (ex. « épaule gauche sensible au développé ») et vos préférences de réponse. Claude les lira.
   - **Données et sauvegardes** : choisissez le **dossier d'export des fiches** (idéalement un dossier OneDrive ou Google Drive synchronisé avec votre téléphone). Une sauvegarde automatique de la base est faite chaque jour.
4. **Nutrition → Objectifs** : saisissez vos calories et macros (ligne « Par défaut », et si vous le souhaitez des valeurs différentes les jours de repos, de musculation ou de cardio).

## Étape 4 — Installer Claude Desktop

1. Téléchargez Claude Desktop pour Windows : **https://claude.ai/download**
2. Installez-le et connectez-vous avec votre compte Claude.

## Étape 5 — Connecter Claude Desktop à TrAIning

1. Dans TrAIning, ouvrez **Claude Desktop** dans le menu de gauche (ou `Ctrl+6`).
2. Cliquez sur **Connecter automatiquement**. L'état passe à **connecté** (une copie de sauvegarde de l'ancienne configuration de Claude est conservée).
3. Cliquez sur **Tester l'accès à la base** : vous devez voir **Test réussi**.
4. **Quittez complètement Claude Desktop** : clic droit sur son icône dans la zone de notification (à côté de l'horloge) → **Quitter**. Fermer la fenêtre ne suffit pas.
5. Rouvrez Claude Desktop. Dans une nouvelle conversation, cliquez sur l'icône des outils : **training** doit apparaître avec ses outils.
6. Demandez : **« Quel est mon programme ? »**. Claude demande l'autorisation d'utiliser l'outil `get_program` : choisissez **Toujours autoriser** pour les outils de lecture.

> **Écritures dans le journal** : avant d'ajouter un aliment, Claude vous montre un récapitulatif (aliment, quantité, kcal, macros, source) et attend votre « OK ». C'est voulu.

### Si la connexion automatique ne marche pas

1. Dans TrAIning → **Claude Desktop**, ouvrez **Configuration manuelle** et cliquez sur **Copier le bloc**.
2. Dans Claude Desktop : **Fichier → Paramètres → Développeur → Modifier la configuration**. Cela ouvre le dossier contenant `claude_desktop_config.json` ; ouvrez ce fichier avec le Bloc-notes.
3. Si le fichier est vide ou ne contient que `{}`, remplacez tout par le bloc copié. S'il contient déjà `"mcpServers"`, ajoutez seulement l'entrée `"training": { … }` à l'intérieur.
4. Enregistrez, puis quittez et rouvrez Claude Desktop (étape 5.4).

## Étape 6 — Utilisation au quotidien

- **Avant la séance** : **Programme** → onglet de la séance → **Exporter en image** → **Enregistrer** : la fiche arrive sur votre téléphone via le dossier synchronisé. Ou **Journal → + Séance** puis **Exporter en image** depuis la séance planifiée.
- **Après la séance** : **Journal** → la séance → les valeurs prévues sont pré-remplies : corrigez seulement les écarts et cochez. Ajoutez fatigue, courbatures, douleurs, cardio. Tout est enregistré immédiatement.
- **Repas** : **Nutrition → + Ajouter**, ou dans Claude Desktop avec le prompt **Saisir un repas** (bouton **+** → TrAIning).
- **Poids** : **Corps** quand vous vous pesez (aucune obligation quotidienne).
- **Bilan de la semaine** : dans Claude Desktop, prompt **Analyse de la semaine**.
- **Raccourcis clavier** : touche `?` dans l'application.

## Mises à jour

Chaque nouvelle version est publiée au même endroit (étape 1). Téléchargez et lancez le nouvel installeur : il remplace l'application sans toucher à vos données. Relancez ensuite **Claude Desktop → Connecter automatiquement** seulement si la page indique « à mettre à jour ».

## Où sont mes données ?

| Élément | Emplacement |
|---|---|
| Base (séances, nutrition, poids…) | `%APPDATA%\fr.training.journal\training.db` |
| Images d'exercices, photos | `%APPDATA%\fr.training.journal\media\` |
| Sauvegardes automatiques | `%APPDATA%\fr.training.journal\backups\` (modifiable dans Paramètres) |
| Application et serveur MCP | `%LOCALAPPDATA%\TrAIning\` |

Pour tout copier ailleurs (disque externe, cloud) : **Paramètres → Données et sauvegardes → Exporter toutes les données…** Pour revenir en arrière : **Restaurer** (une copie de sécurité de l'état actuel est faite avant).

Désinstaller l'application (Paramètres Windows → Applications) **ne supprime pas** vos données.

## Dépannage

| Problème | Solution |
|---|---|
| « Windows a protégé votre ordinateur » | Informations complémentaires → Exécuter quand même (étape 2). |
| Claude ne voit pas « training » | Vérifier « connecté » dans TrAIning → Claude Desktop, puis **quitter** vraiment Claude Desktop (zone de notification) et le rouvrir. |
| Claude dit que la base est introuvable ou en mauvaise version | Lancer TrAIning une fois (il met la base à jour), puis relancer Claude Desktop. |
| Pas d'aliments Ciqual dans la recherche | Nutrition → Aliments & recettes → Base Ciqual → Télécharger la dernière version (ou importer le ZIP « XML » téléchargé sur ciqual.anses.fr). |
| Open Food Facts ne répond pas | Service en ligne parfois lent : réessayer ; les produits déjà consultés restent disponibles hors ligne. |
| Les modifications faites par Claude n'apparaissent pas | Elles s'affichent en une seconde environ (notification « Données mises à jour depuis Claude Desktop ») ; sinon changer de page et revenir. |
