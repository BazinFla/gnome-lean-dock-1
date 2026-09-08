<div align="center">

<p align="center">
  <a href="README.md">🇬🇧 English</a> &nbsp;•&nbsp; <a href="docs/README.fr.md">🇫🇷 Français</a>
</p>

# 💉 Gnome Lean Dock 1 (GLD-1)
*No shady prescription required.*

### Dock for GNOME Shell

[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-49%20%7C%2050-3584e4.svg?style=flat-square&logo=gnome)](https://gitlab.gnome.org/GNOME/gnome-shell)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-green.svg?style=flat-square)](LICENSE)

A dock extension for GNOME Shell focused on core dock workflows and native desktop integration.

</div>

---

## Features

- **Dock Positioning**: Supports Bottom, Left, Right, and Top panel placements.
- **Intellihide**: Keeps the dock visible on the desktop and hides when overlapping with windows.
- **AppGrid Integration**: Access pinned and favorite applications from the overview AppGrid and folders.
- **Window Previews**: Window preview popups with focus, minimize, and close actions.
- **Running Indicators**: Configurable indicators (dots, pill, dash, glow) synchronized with GNOME accent color.
- **Click & Scroll Behaviors**: Configurable middle-click actions and dock icon scroll cycling.

---

## Compatibility

- **GNOME Shell**: `49`, `50`

---

## Installation

### Method 1: Release (Recommended)

**1. Download and install:**
```bash
curl -L -o gld-1@bazinfla.github.com.shell-extension.zip https://github.com/bazinfla/gnome-lean-dock-1/releases/latest/download/gld-1@bazinfla.github.com.shell-extension.zip && \
gnome-extensions install --force gld-1@bazinfla.github.com.shell-extension.zip && \
rm gld-1@bazinfla.github.com.shell-extension.zip
```

**2. Restart GNOME Shell:**
- **Wayland**: Log out and log back in.
- **X11**: Press `Alt + F2`, type `r`, and press `Enter`.

**3. Enable the extension:**
```bash
gnome-extensions enable gld-1@bazinfla.github.com
```

### Method 2: From Source

**1. Clone the repository and install:**
```bash
git clone https://github.com/bazinfla/gnome-lean-dock-1.git && \
cd gnome-lean-dock-1 && \
./scripts/install.sh
```

**2. Restart GNOME Shell:**
- **Wayland**: Log out and log back in.
- **X11**: Press `Alt + F2`, type `r`, and press `Enter`.

**3. Enable the extension:**
```bash
gnome-extensions enable gld-1@bazinfla.github.com
```

---

## Uninstallation

```bash
gnome-extensions uninstall gld-1@bazinfla.github.com
```

---

## Configuration

Open preferences from:
- Right-click on the dock > **Preferences**
- The **Extensions** app
- Terminal:
  ```bash
  gnome-extensions prefs gld-1@bazinfla.github.com
  ```

---

## Credits

Derived and streamlined from **[Dash to Dock](https://github.com/micheleg/dash-to-dock)** by **[michele_g](https://github.com/micheleg)**.

---

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).