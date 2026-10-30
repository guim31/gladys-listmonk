# Listmonk

[Listmonk](https://listmonk.app/) est un gestionnaire de newsletters et de
listes de diffusion auto-hébergé, libre (AGPL-3.0). Cette intégration amène
votre newsletter dans Gladys : l'instance Listmonk devient un appareil
(joignable ou non, abonnés, arrivées et désinscriptions du jour, messages
envoyés, campagne en cours et son avancement, taux d'ouverture et de clics de
la dernière campagne), et chaque liste de diffusion choisie devient un appareil
avec ses abonnés et ses désinscrits. Des scènes peuvent réagir à un nouvel
abonné, à une désinscription ou à une campagne terminée, et une action de scène
lance ou met en pause une campagne. Un widget de tableau de bord montre les
chiffres et les dernières campagnes.

Testée face à un vrai Listmonk 6.2.0 auto-hébergé (Docker, PostgreSQL), avec
une campagne réellement envoyée, mise en pause et reprise ; vos retours sont
les bienvenus sur [les issues](https://github.com/guim31/gladys-listmonk/issues).

## Ce qu'il vous faut

- Gladys Assistant 5.1.0 ou plus récent.
- Listmonk 4.0 ou plus récent (utilisateurs d'API), joignable depuis la machine
  de Gladys.
- Un **utilisateur d'API** de Listmonk et son jeton.

À chaque rafraîchissement, l'intégration envoie six requêtes légères (compteurs
du tableau de bord, listes, les 20 campagnes les plus récentes, les 20 derniers
abonnés, deux comptages du jour), quelle que soit la taille de votre instance.

## Prise en main

### 1. Créer un utilisateur d'API

Dans Listmonk, ouvrez **Admin → Utilisateurs → Nouveau**, choisissez le type
**API**, un nom (par exemple `gladys`) et un rôle, puis enregistrez : Listmonk
affiche le jeton une seule fois, copiez-le.

Le rôle décide de ce que l'intégration voit et fait. La lecture demande les
permissions `subscribers:get_all`, `lists:get_all`, `campaigns:get_all` ; les
chiffres du jour demandent `subscribers:sql_query` (sans elle, tout le reste
fonctionne) ; lancer et mettre en pause une campagne demande `campaigns:send`
et `campaigns:manage_all`.

### 2. Configurer l'intégration

Dans Gladys, ouvrez **Intégrations → Listmonk → Configuration** :

- **Adresse de Listmonk** : l'adresse à laquelle vous ouvrez Listmonk, par
  exemple `http://192.168.1.10:9000` ou `https://listes.example.org`. Une
  adresse copiée avec `/admin/...` est comprise.
- **Utilisateur d'API** et **Jeton d'API** : ceux de l'étape 1.
- **Intervalle de rafraîchissement** : de 1 à 10 minutes (2 minutes par
  défaut).
- **Autoriser le lancement et la pause des campagnes** : désactivé par défaut.
  Sans lui, l'action de scène est refusée.
- **Langue des noms** : la langue des noms des fonctionnalités, fixés à l'ajout
  d'un appareil, de l'état de la campagne et des messages de scène.

**Tester la connexion** lit Listmonk et répond avec le nombre d'abonnés, de
listes et de campagnes.

### 3. Ajouter l'instance et les listes

Ouvrez l'onglet **Découverte** de l'intégration : il liste l'instance Listmonk
et vos listes de diffusion. Ajoutez l'instance, et les listes à suivre.

## Les appareils

L'instance Listmonk :

| Fonctionnalité                       | Ce qu'elle montre                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Joignable                            | 1 quand Listmonk répond, 0 après deux lectures ratées d'affilée                                            |
| Abonnés                              | tous les abonnés de l'instance                                                                             |
| Bloqués                              | les abonnés bloqués                                                                                        |
| Nouveaux abonnés aujourd'hui         | les abonnés créés aujourd'hui (depuis minuit)                                                              |
| Désinscriptions aujourd'hui          | les abonnés qui ont quitté au moins une liste aujourd'hui                                                  |
| Messages envoyés                     | les messages de campagne envoyés depuis que Listmonk compte                                                |
| Campagne                             | la campagne en cours d'envoi ou en pause, sinon la dernière envoyée ou annulée, avec son état              |
| Avancement de la campagne            | ses messages envoyés, en pourcentage des messages à envoyer                                                |
| Taux d'ouverture (dernière campagne) | ouvertures de la dernière campagne envoyée, en pourcentage de ses messages (ouvertures répétées comprises) |
| Taux de clics (dernière campagne)    | clics de la dernière campagne envoyée, en pourcentage de ses messages                                      |

Chaque liste ajoutée :

| Fonctionnalité | Ce qu'elle montre                                  |
| -------------- | -------------------------------------------------- |
| Abonnés        | les inscriptions confirmées et non confirmées      |
| Désinscrits    | les abonnés qui se sont désinscrits de cette liste |

« Aujourd'hui » commence à minuit dans le fuseau horaire de Gladys.

## Tableau de bord

Le widget **Campagnes Listmonk** montre les abonnés, les arrivées et les départs
du jour, puis les dernières campagnes : en cours d'envoi (messages envoyés / à
envoyer), en pause, envoyée (messages et taux d'ouverture), brouillon. Ses
réglages choisissent le nombre de campagnes (3, 5 ou 8) et masquent les
chiffres ou le bouton **Actualiser**, qui relit Listmonk.

## Scènes

### Déclencheurs

- **Nouvel abonné** : un abonné est ajouté à Listmonk (formulaire d'inscription,
  import, API), une fois par liste rejointe. Choisissez les listes (vide :
  toutes). Variables : nom, adresse e-mail, liste. Jusqu'à 20 nouveaux abonnés
  par rafraîchissement sont annoncés : après un gros import, les autres sont
  comptés, pas annoncés.
- **Désinscription** : des abonnés quittent une liste (ou sont bloqués).
  Choisissez les listes (vide : toutes). Variables : liste, nouvelles
  désinscriptions, désinscrits au total, abonnés restants.
- **Campagne terminée** : une campagne a été envoyée à tous ses abonnés.
  Variables : campagne, objet, listes, messages envoyés, ouvertures, clics.

### Actions

- **Lancer ou mettre en pause une campagne** : lance une campagne en brouillon
  ou en pause, ou met en pause une campagne en cours d'envoi. Indiquez
  son nom exact, ou son identifiant précédé de `#` (affiché dans Listmonk,
  `#12`). Un nombre seul comme `2025` vaut pour un nom ou un identifiant :
  l'action refuse quand les deux existent. Lancer une campagne déjà en cours d'envoi, ou mettre en pause une
  campagne déjà en pause, ne fait rien. Sorties : campagne, identifiant de la
  campagne, nouvel état. **Refusée tant que « Autoriser le lancement et la pause
  des campagnes » n'est pas activé** : lancer une campagne envoie de vrais
  e-mails à tous les abonnés de ses listes.

### Idées de scènes

- Une notification pour chaque nouveau membre de votre club : déclencheur
  **Nouvel abonné** sur la liste « Membres du club », message avec le nom.
- Envoyer le samedi à 9 h la newsletter préparée à l'avance : **Lancer ou mettre
  en pause une campagne**, nom de la campagne, commande Lancer.
- Annoncer la fin d'un envoi : déclencheur **Campagne terminée**, message avec
  les messages envoyés.

## Dépannage

- **« Listmonk ne répond pas »** : vérifiez l'adresse et que Gladys joint le
  serveur (même réseau, pare-feu, port).
- **« utilisateur d'API ou jeton refusé, ou permission manquante »** : vérifiez
  le nom de l'utilisateur d'API et son jeton (Listmonk ne l'affiche qu'à la
  création : créez-en un nouveau s'il est perdu), et le rôle de l'utilisateur.
- **Pas de chiffres du jour** : le rôle de l'utilisateur d'API n'a pas
  `subscribers:sql_query` ; **Tester la connexion** le signale.
- **« aucune API Listmonk à cette adresse »** : l'adresse pointe vers autre
  chose : utilisez celle à laquelle vous ouvrez Listmonk.
- **« l'adresse redirige »** : saisissez directement l'adresse en `https://`.
- **« certificat refusé »** : le certificat HTTPS est auto-signé ou expiré :
  utilisez l'adresse `http://` sur votre réseau local, ou un certificat reconnu.
- Les logs ne montrent jamais un abonné : ni nom, ni adresse e-mail.

## Limites

- Listmonk 4.0 ou plus récent seulement (utilisateurs d'API). Le taux
  d'ouverture compte les ouvertures que Listmonk enregistre (un pixel de
  suivi) : les ouvertures répétées comptent, les messageries qui bloquent les
  images ne sont pas comptées.
- Un abonné ajouté à une liste après sa création ne déclenche pas **Nouvel
  abonné** : seuls les nouveaux abonnés le font. **Désinscription** donne le
  nombre de départs, pas qui est parti.
- **Campagne terminée** suit les 20 campagnes les plus récentes.
- Développée avec un Listmonk dans Docker et les outils de test de Gladys, pas
  sur une instance Gladys en production : vos retours sont les bienvenus.
