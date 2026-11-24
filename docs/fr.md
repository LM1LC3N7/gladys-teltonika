# Teltonika

Les routeurs 4G/5G [Teltonika](https://teltonika-networks.com) (séries RUTX,
RUT, RUTM, TRB, sous RutOS 7 ou plus récent) dans Gladys, par l'API HTTP
locale du routeur. Utile pour une résidence secondaire, un camping-car ou
une connexion de secours :

- chaque **modem** du routeur devient un appareil Gladys (onglet
  Découverte) : **données mobiles connectées** (oui / non), **signal** en
  barres (0 à 5) et en valeurs (**RSSI**, **RSRP**, **RSRQ**, **SINR**),
  **opérateur**, **type de réseau** (4G, 5G NSA…), **bande**, état de la
  **carte SIM**, **température** du modem, **débits** descendant et montant,
  **données reçues** et **envoyées** ;
- le **routeur** devient un appareil avec son **firmware** et un bouton
  **Redémarrer le routeur**, inactif tant que vous ne l'autorisez pas ;
- deux déclencheurs de scène : **Données mobiles perdues** et **Données
  mobiles revenues** ;
- un widget de tableau de bord, **Routeur mobile** : barres de signal,
  opérateur, type de réseau, connexion de données et débits d'un modem en un
  coup d'œil.

> **Cette intégration n'a jamais été testée avec un vrai routeur.** Cette
> première version a été portée depuis teltasync, la bibliothèque qu'utilise
> Home Assistant, et testée seulement contre un faux routeur. Dites sur le
> forum Gladys ce qui marche et ce qui ne marche pas, avec le modèle et la
> version de RutOS.

Intégration non officielle, sans lien avec Teltonika.

## Avant de commencer

1. Le routeur doit être sous **RutOS 7** ou plus récent (l'API HTTP n'existe
   pas avant). La version est dans l'interface web, **Système**, **Firmware**.
2. Choisissez le compte que Gladys utilisera. Le compte `admin` marche ; un
   compte dédié est préférable : dans **Système**, **Administration**,
   **Utilisateurs**, créez un utilisateur avec un accès en lecture à l'API
   (et en écriture seulement si vous voulez le bouton Redémarrer).
3. Notez l'adresse IP du routeur sur votre réseau local (celle de son
   interface web, souvent `192.168.1.1`).

## Configuration

- **Adresse du routeur** : son adresse IP ou son nom d'hôte. Une adresse
  collée depuis un navigateur (`https://192.168.1.1`) est lue comme son
  protocole, son hôte et son port.
- **Protocole** : **HTTPS** par défaut. Le routeur a un certificat
  auto-signé, qu'aucune autorité ne garantit : Gladys l'apprend à la
  première connexion et garde son empreinte SHA-256 dans son volume `/data`.
  Si le routeur présente ensuite un autre certificat (réinitialisation,
  nouveau certificat, ou un autre appareil à cette adresse), Gladys s'arrête
  **avant d'envoyer quoi que ce soit** et le dit dans le statut : si c'est
  vous qui avez changé le certificat, enregistrez la configuration pour
  accepter le nouveau. **HTTP** envoie le mot de passe en clair sur votre
  réseau ; beaucoup de routeurs redirigent d'ailleurs le HTTP vers le HTTPS.
- **Port** : vide, 443 en HTTPS et 80 en HTTP.
- **Nom d'utilisateur** : `admin` par défaut.
- **Mot de passe** : gardé par Gladys dans sa base, jamais réaffiché, envoyé
  seulement au routeur. Il est pris tel que vous le tapez (une espace au
  début ou à la fin compte). L'intégration ne l'écrit jamais dans ses
  journaux ni dans `/data`, pas plus que le jeton de session du routeur.
- **Rafraîchissement** : fréquence de lecture des modems (toutes les minutes
  par défaut, une requête à chaque fois). Le routeur donne un jeton valable
  environ cinq minutes : Gladys se reconnecte à peu près une fois toutes les
  cinq minutes. Le modèle et le firmware sont relus une fois par heure.
- **Autoriser le redémarrage du routeur** : désactivé par défaut (voir plus
  bas).

Le bouton **Tester la connexion** dit ce que le routeur répond. Comme
l'analyse de l'onglet Découverte et un redémarrage de Gladys, il ne relit le
routeur que si la dernière lecture est plus ancienne que le
rafraîchissement ; après une erreur, il redonne le statut de cette erreur
jusqu'au prochain essai, sans requête. Seul l'enregistrement de la
configuration relit tout de suite.

## Les valeurs

- **Signal (barres)** : notre échelle à partir du RSSI : 5 barres à -65 dBm
  ou mieux, 4 à -75, 3 à -85, 2 à -95, 1 à -105, 0 en dessous. L'interface
  web de RutOS peut afficher une autre échelle.
- **RSSI**, **RSRP** (dBm), **RSRQ**, **SINR** (dB) : telles que le routeur
  les donne. Gladys n'a pas d'unité dBm : l'unité est dans le nom de la
  fonctionnalité.
- **Débits** (kbit/s) : moyennes entre deux lectures, calculées à partir des
  compteurs du modem. Pas de débit à la première lecture, après une coupure,
  ni quand un compteur repart de zéro.
- **Données reçues / envoyées** (Mo, millions d'octets) : les compteurs du
  modem, tels que RutOS les donne ; ils repartent de zéro quand le modem se
  reconnecte ou redémarre. Ce ne sont pas les compteurs de forfait.
- **Carte SIM** : l'état de la carte, ou ce qu'elle demande (PIN, PUK).
- Un modem hors ligne garde son appareil, montré non connecté.

## Le widget Routeur mobile

Sur un tableau de bord, passez en édition, ajoutez une boîte et choisissez
**Routeur mobile** (Teltonika). Un modem par widget : choisissez-le dans les
réglages du widget (**Modem**) ; laissé vide, ou avec le routeur choisi, le
widget montre le premier modem listé par le routeur, et dit lequel quand il
y en a plusieurs. Un modem que le routeur ne liste plus n'est jamais
remplacé par un autre.

Le widget montre :

- l'**opérateur** en titre ;
- le **signal** en barres, comme sur un téléphone (▮▮▮▯▯ pour 3 barres sur
  5 ; rouge à 0 ou 1 barre, orange à 2, vert au-delà) ;
- le **type de réseau** tel que le routeur le donne (4G (LTE), 5G (NSA)…) ;
- les **débits** descendant et montant (kbit/s, Mbit/s à partir de
  1000 kbit/s) ;
- **Données mobiles** : connectées (vert) ou non (rouge) ; **Routeur** :
  répond (vert) ou non lu (rouge), avec la raison ;
- un bouton **Redémarrer**, seulement quand **Autoriser le redémarrage du
  routeur** est activé. Gladys demande d'abord une confirmation, puis le
  redémarrage passe par les mêmes vérifications que le bouton Redémarrer de
  l'appareil routeur (plus bas). **Toute personne qui voit le widget peut
  l'utiliser** : chaque compte dont le tableau de bord le contient, tableau
  de bord partagé ou public compris (Gladys envoie l'action sans le nom de
  l'utilisateur). N'activez l'option que si cela vous convient. Un refus
  s'affiche en anglais et en français.

Il n'utilise que ce que l'intégration lit déjà, au rythme du rafraîchissement
choisi. Une valeur que le routeur ne donne pas, un débit avant deux lectures,
ou toute valeur quand le routeur n'est pas lu s'affiche **inconnu**, jamais
la dernière valeur. Juste après l'envoi d'un redémarrage, le widget affiche
**Redémarrage envoyé** (orange) et plus rien de la dernière lecture, jusqu'à
ce qu'une lecture du routeur réussisse de nouveau. La raison affichée quand
le routeur n'est pas lu ne reprend pas le délai avant le nouvel essai (voir
le statut de l'intégration pour lui). Gladys recharge le widget quand ce
qu'il montre change, une fois toutes les 10 secondes environ au plus.

Le widget n'a pas besoin d'appareil ajouté depuis la Découverte : il lit
l'intégration elle-même. Pour choisir un modem dans ses réglages, ajoutez ce
modem depuis la Découverte.

## Redémarrage du routeur

Un redémarrage coupe Internet pour tout ce qui passe par le routeur pendant
une ou deux minutes, Gladys compris s'il passe par lui. C'est pourquoi :

- le bouton (de l'appareil routeur ou du widget) refuse tant que
  **Autoriser le redémarrage du routeur** n'est pas activé ;
- c'est un bouton, jamais un interrupteur : un « éteins tout » d'un
  assistant vocal ou d'une scène ne l'atteint pas ;
- avant d'envoyer, Gladys relit le routeur et vérifie que c'est le même
  (même numéro de série, gardé seulement comme une empreinte) ; l'option est
  revérifiée juste avant l'envoi ; si le routeur est trop lent, le
  redémarrage n'est pas envoyé et Gladys le dit ;
- un seul redémarrage toutes les 10 minutes (même après un redémarrage de
  l'intégration) : une scène qui boucle ne peut pas le relancer sans cesse ;
- si le routeur ne répond pas après l'envoi, Gladys dit « envoyé, sans
  confirmation » : il a pu redémarrer.

## Déclencheurs de scène

- **Données mobiles perdues** : un modem qui avait une connexion de données
  l'a perdue à la lecture suivante.
- **Données mobiles revenues** : un modem qui n'avait plus de connexion en a
  de nouveau une.

Filtrez sur un modem ou laissez vide pour tous. Variables : le nom du modem
et l'opérateur. Aucun déclencheur ne part à la première lecture ni après une
panne du routeur (chaque lecture n'est comparée qu'à la précédente).

## En cas de problème

Le statut de connexion de l'intégration dit ce qui se passe :

- **Nom d'utilisateur ou mot de passe refusé** : Gladys s'arrête et ne
  réessaie pas seul, même après un redémarrage (le routeur pourrait bloquer
  le compte après plusieurs échecs). Vérifiez-les et enregistrez la
  configuration.
- **Le routeur accepte la connexion mais refuse les lectures** : le compte
  n'a pas les droits sur l'API ; Gladys réessaie en espaçant.
- **Certificat HTTPS changé** : voir Protocole plus haut.
- **HTTP 429 ou erreur serveur (5xx)** : toutes les requêtes sont suspendues
  (d'une minute à six heures), et la pause survit à un redémarrage.
- **Pas de réponse, mauvaise adresse, mauvais protocole** : Gladys réessaie,
  jamais plus vite que le rafraîchissement, en attendant plus longtemps à
  chaque fois (jusqu'à 30 minutes).

## Vie privée

Gladys ne garde que ce qu'il montre. L'IMEI, l'IMSI, l'ICCID, les numéros de
série, les adresses MAC, les identifiants de cellule et les numéros de
téléphone que le routeur renvoie ne sont jamais repris : ni dans Gladys, ni
dans les journaux, ni dans `/data`. Un texte qui contient un long numéro
(qui n'aurait rien à y faire) ou une adresse MAC n'est pas affiché.

L'intégration ne fait pas encore la liste des appareils connectés au
routeur ni la présence (voir TODO.md).
