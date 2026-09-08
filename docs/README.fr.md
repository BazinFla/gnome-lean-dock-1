<div align="center">

<p align="center">
  <a href="../README.md">🇬🇧 English</a> &nbsp;•&nbsp; <a href="README.fr.md">🇫🇷 Français</a>
</p>

# 💉 Gnome Lean Dock 1 (GLD-1)
*Aucune ordonnance douteuse requise.*

### Dock pour GNOME Shell

[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-49%20%7C%2050-3584e4.svg?style=flat-square&logo=gnome)](https://gitlab.gnome.org/GNOME/gnome-shell)
[![Licence: GPL v3](https://img.shields.io/badge/Licence-GPLv3-green.svg?style=flat-square)](../LICENSE)

Une extension dock pour GNOME Shell axée sur les fonctionnalités essentielles et l'intégration native au bureau.

</div>

---

## Fonctionnalités

- **Positionnement du dock** : Emplacements en bas, à gauche, à droite ou en haut de l'écran.
- **Masquage intelligent (Intellihide)** : Reste visible sur le bureau et s'efface lors du chevauchement avec une fenêtre.
- **Intégration à l'AppGrid** : Conservation des applications favorites/épinglées accessibles dans la vue d'ensemble et les dossiers.
- **Aperçu des fenêtres** : Menus d'aperçu avec actions directes (activer, réduire, fermer).
- **Indicateurs d'applications ouvertes** : Plusieurs styles d'indicateurs (points, barre, trait, lueur) synchronisés avec la couleur d'accentuation de GNOME.
- **Actions au clic et au défilement** : Actions configurables pour le clic milieu et le défilement de la molette sur les icônes.

---

## Compatibilité

- **GNOME Shell** : `49`, `50`

---

## Installation

### Méthode 1 : Via la release (Recommandé)

**1. Télécharger et installer :**
```bash
curl -L -o gld-1@bazinfla.github.com.shell-extension.zip https://github.com/bazinfla/gnome-lean-dock-1/releases/latest/download/gld-1@bazinfla.github.com.shell-extension.zip && \
gnome-extensions install --force gld-1@bazinfla.github.com.shell-extension.zip && \
rm gld-1@bazinfla.github.com.shell-extension.zip
```

**2. Redémarrer GNOME Shell :**
- **Wayland** : Déconnectez-vous puis reconnectez-vous.
- **X11** : Appuyez sur `Alt + F2`, tapez `r`, puis validez avec `Entrée`.

**3. Activer l'extension :**
```bash
gnome-extensions enable gld-1@bazinfla.github.com
```

### Méthode 2 : Depuis les sources

**1. Cloner le dépôt et installer :**
```bash
git clone https://github.com/bazinfla/gnome-lean-dock-1.git && \
cd gnome-lean-dock-1 && \
./scripts/install.sh
```

**2. Redémarrer GNOME Shell :**
- **Wayland** : Déconnectez-vous puis reconnectez-vous.
- **X11** : Appuyez sur `Alt + F2`, tapez `r`, puis validez avec `Entrée`.

**3. Activer l'extension :**
```bash
gnome-extensions enable gld-1@bazinfla.github.com
```

---

## Désinstallation

```bash
gnome-extensions uninstall gld-1@bazinfla.github.com
```

---

## Configuration

Ouvrez les préférences depuis :
- Clic droit sur le dock > **Préférences**
- L'application **Extensions**
- Le terminal :
  ```bash
  gnome-extensions prefs gld-1@bazinfla.github.com
  ```

---

## Crédits

Dérivé et optimisé à partir de **[Dash to Dock](https://github.com/micheleg/dash-to-dock)** par **[michele_g](https://github.com/micheleg)**.

---

## Licence

Ce projet est sous licence [GNU General Public License v3.0](../LICENSE).
